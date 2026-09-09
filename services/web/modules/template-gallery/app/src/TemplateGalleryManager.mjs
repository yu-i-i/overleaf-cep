import _ from 'lodash'
import logger from '@overleaf/logger'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { Readable } from 'node:stream'
import settings from '@overleaf/settings'
import * as SiteSettingsManager from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import { OError } from '../../../../app/src/Features/Errors/Errors.js'
import { Template } from './models/Template.mjs'
import {
  validateTemplateInput,
  renderTemplateHtmlFields,
  uploadTemplateAssets,
  deleteTemplateAssets,
  canUserOverrideTemplate,
  generateTemplateData
} from './TemplateGalleryHelper.mjs'
import { cleanHtml }  from './CleanHtml.mjs'
import { TemplateNameConflictError } from './TemplateErrors.mjs'
import { fetchStreamWithResponse } from '@overleaf/fetch-utils'
import archiver from 'archiver'
const TIMEOUT = 30000
const MAX_BUNDLE_ASSET_BYTES = 30 * 1024 * 1024 // per-asset cap (zip/pdf)

// R6-item1 (2026-08-29): neutral document-style placeholder served when a
// template has no compiled PDF yet (e.g. bundle imported without output.pdf
// and never compiled). Serves as <img> content for style=thumbnail|preview.
const TEMPLATE_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">\n  <rect width="400" height="500" fill="#eef1f4"/>\n  <rect x="70" y="50" width="260" height="400" fill="#ffffff" stroke="#c9d2db" stroke-width="2"/>\n  <rect x="95" y="86" width="150" height="16" rx="8" fill="#9aa7b4"/>\n  <rect x="95" y="122" width="210" height="9" rx="4.5" fill="#d5dce4"/>\n  <rect x="95" y="142" width="190" height="9" rx="4.5" fill="#d5dce4"/>\n  <rect x="95" y="162" width="205" height="9" rx="4.5" fill="#d5dce4"/>\n  <rect x="95" y="182" width="160" height="9" rx="4.5" fill="#d5dce4"/>\n  <rect x="280" y="330" width="25" height="25" fill="#9aa7b4"/>\n  <text x="292.5" y="348.5" font-family="Georgia, serif" font-size="16" fill="#ffffff" text-anchor="middle" font-style="italic">f</text>\n</svg>`


async function editTemplate({ templateId, updates }) {

  validateTemplateInput(updates)

  const template = await Template.findById(templateId)
  if (!template) {
    throw new OError('Current template not found, strange...', { status: 500, templateId })
  }

  if (updates.name) {
    const conflictingTemplate = await Template.findOne(
      { name: updates.name, _id: { $ne: templateId } },
      { owner: true }
    ).exec()
    if (conflictingTemplate) {
      throw new TemplateNameConflictError(String(conflictingTemplate.owner))
    }
  }

  await renderTemplateHtmlFields(updates)
  updates.lastUpdated = new Date()
  Object.assign(template, updates)

  await template.save()

  return updates
}

async function deleteTemplate({ templateId, version }) {
  await deleteTemplateAssets(templateId, version, true)
}

async function createTemplateFromProject({ projectId, userId, templateSource }) {
  validateTemplateInput(templateSource)
  let template = await Template.findOne({ name: templateSource.name }).exec()

  if (template && !templateSource.override) {
    const { canOverride, templateOwnerName } = await canUserOverrideTemplate(template, userId)

    return {
      conflict: true,
      canOverride,
      templateOwnerName
    }
  }

  const templateData = await generateTemplateData(projectId, templateSource)

  let previousVersionExists
  if (!template) {
    template = new Template(templateData)
    template.owner = userId
    previousVersionExists = false
  } else {
    Object.assign(template, templateData, {
      version: template.version + 1,
    })
    previousVersionExists = true
  }

  await uploadTemplateAssets(projectId, userId, templateSource.build, template)
  await template.save()

  if (previousVersionExists) {
    // Intentional fire-and-forget: previous-version asset cleanup does not
    // gate the create response.
    void deleteTemplateAssets(template._id, template.version - 1, false)
  }
  return {
    conflict: false,
    templateId: template._id,
  }
}

async function fetchTemplatePreview({ templateId, version, style }) {
  if (!templateId || !version) {
    throw new OError('Template ID and version are required', { status: 404 })
  }
  const styleParam = style ? `style=${style}` : ''
  const isImage = (style === 'preview' || style === 'thumbnail')

  if (style && !isImage) {
    throw new OError('Wrong style', { status: 404, style })
  }

  const pdfUrl = `${settings.apis.filestore.url}/template/${templateId}/v/${version}/pdf?${styleParam}`
  const { response } = await fetchStreamWithResponse(pdfUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(TIMEOUT),
  })

  if (!response.ok) {
    if (isImage) {
      // No compiled PDF yet (e.g. uncompiled bundle import) — show a
      // placeholder thumbnail instead of erroring out (R6-item1).
      try { response.body?.destroy?.() } catch { /* ignore */ }
      return {
        stream: Readable.from(Buffer.from(TEMPLATE_PLACEHOLDER_SVG)),
        contentType: 'image/svg+xml',
      }
    }
    throw new OError(`Failed to fetch file: ${response.statusText}`, { status: 404, templateId, version, styleParam })
  }

  return {
    stream: Readable.from(response.body),
    contentType: isImage ? 'application/octet-stream' : 'application/pdf'
  }
}

async function getTemplatesPageData(category) {
  let links = (settings.templateLinks || []).map(l => ({ ...l }))
  try {
    const section = await SiteSettingsManager.getSection('templates', settings)
    links = (section.categories || [])
      .filter(c => c.enabled)
      .map(c => ({
        name: c.name,
        url: `/templates/${c.key}`,
        description: c.description || '',
      }))
  } catch {
    // env-seed fallback (settings.templateLinks)
  }
  const categoryName = links.find(item => (item.url || '').endsWith(`/${category}`))?.name
  const templateLinks = categoryName ? undefined : links.filter(link => link.url !== '/templates/all')
  return {
    categoryName,
    templateLinks
  }
}

// SECURITY: key/val reach here from user-controlled route params and query
// strings. Building `{ [key]: val }` directly was a Mongoose query-injection
// hole (e.g. key=$where = server-side JS oracle; unknown keys degenerated to
// findOne({})). Only the two lookups the product actually performs are
// allowed, with value validation for _id; anything else is a safe miss.
async function getTemplate(key, val) {
  if (key === '_id') {
    if (!mongoose.Types.ObjectId.isValid(String(val))) {
      logger.warn('getTemplate: invalid _id provided')
      return null
    }
    const template = await Template.findById(val).exec()
    if (!template) return null

    return _formatTemplateForPage(template)
  }

  if (key === 'name') {
    const template = await Template.findOne({ name: String(val) }).exec()
    if (!template) return null

    return _formatTemplateForPage(template)
  }

  logger.warn('getTemplate: unknown lookup key ignored', { key })
  return null
}

async function getCategoryTemplates(reqQuery) {
  const {
    category = 'all',
    by = 'lastUpdated',
    order = 'desc',
  } = reqQuery || {}

  const query = (category === 'all') ? {} : { category : '/templates/' + category }
  const projection = { _id : 1, version : 1, name : 1, author : 1, description : 1, category : 1, lastUpdated : 1 }
  const allTemplates = await Template.find(query, projection).exec()
  const formattedTemplates = allTemplates.map(_formatTemplateForList)
  const sortedTemplates = _sortTemplates(formattedTemplates, { by, order })

  return {
    totalSize: sortedTemplates.length,
    templates: sortedTemplates,
  }
}

function _sortTemplates(templates, sort) {
  if (
    (sort.by && !['lastUpdated', 'name'].includes(sort.by)) ||
    (sort.order && !['asc', 'desc'].includes(sort.order))
  ) {
    throw new OError('Invalid sorting criteria', { status: 400, sort })
  }
  const sortedTemplates = _.orderBy(
    templates,
    [sort.by || 'lastUpdated'],
    [sort.order || 'desc']
  )
  return sortedTemplates
}

function _formatTemplateForList(template) {
  return {
    id: String(template._id),
    version: String(template.version),
    name: template.name,
    author: cleanHtml(template.author, "plainText"),
    description: cleanHtml(template.description, "plainText"),
    category: template.category,
    lastUpdated: template.lastUpdated,
  }
}

function _formatTemplateForPage(template) {
  return {
    id: template._id.toString(),
    version: template.version.toString(),
    category: template.category,
    name: template.name,
    author: cleanHtml(template.author, "linksOnly"),
    authorMD: template.authorMD,
    description: cleanHtml(template.description, "reachText"),
    descriptionMD: template.descriptionMD,
    license: template.license,
    lastUpdated: template.lastUpdated,
    owner: template.owner,
    mainFile: template.mainFile,
    compiler: template.compiler,
    imageName: template.imageName,
    language: template.language,
  }
}

/**
 * New 3 (2026-08-28): the ENABLED template categories (admin-managed
 * via Manage Extensions -> Templates; env seeds underneath) — used by
 * the ds-nav page switcher (Templates sub-items).
 */
function getEnabledCategories() {
  return SiteSettingsManager.getSection('templates').then(section => {
    return (section.categories || [])
      .filter(c => c.enabled !== false)
      .map(c => ({ key: c.key, name: c.name || c.key }))
  })
}

/* ------------------------------------------------------------------ */
/* 3b (2026-08-28): template bundle save/import.
 * Bundle = zip with template.json (metadata) + source.zip +
 * optional output.pdf. Export assembles from the filestore; import
 * re-uploads source.zip (+output.pdf) for a (new|bumped) Template
 * doc. Admin console surface: Manage Extensions -> Templates.
 */
function _bundleAssetUrls(templateId, version) {
  const base = `${settings.apis.filestore.url}/template/${templateId}/v/${version}`
  return { zip: `${base}/zip`, pdf: `${base}/pdf` }
}

async function _collectStream(stream) {
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    if (total > MAX_BUNDLE_ASSET_BYTES) {
      throw new OError('template asset too large', { status: 413 })
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function _templateToBundleMeta(template) {
  const t = template.toJSON()
  const { _id, __v, owner, ...meta } = t
  return meta
}

async function getTemplateBundle({ templateId, userId }) {
  const template = await Template.findById(templateId)
  if (!template) {
    throw new OError('Template not found', { status: 404, templateId })
  }
  const { canOverride } = await canUserOverrideTemplate(template, userId)
  if (!canOverride) {
    throw new OError('not allowed to download this template bundle', { status: 403 })
  }
  const { zip: zipUrl, pdf: pdfUrl } = _bundleAssetUrls(
    String(template._id),
    template.version
  )
  const zipReq = await fetchStreamWithResponse(zipUrl, {
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!zipReq.response.ok) {
    throw new OError('Template source not found', { status: 404 })
  }
  const sourceZip = await _collectStream(zipReq.stream)
  let outputPdf = null
  try {
    const pdfReq = await fetchStreamWithResponse(pdfUrl, {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (pdfReq.response.ok) outputPdf = await _collectStream(pdfReq.stream)
  } catch (err) {
    logger.warn({ err, templateId }, 'bundle export: no/failed output.pdf (continuing without)')
  }
  const archive = archiver('zip', { zlib: { level: 6 } })
  const chunks = []
  archive.on('data', c => chunks.push(c))
  const finished = new Promise((resolve, reject) => {
    archive.on('end', resolve)
    archive.on('error', reject)
  })
  archive.append(JSON.stringify(_templateToBundleMeta(template), null, 2), {
    name: 'template.json',
  })
  archive.append(sourceZip, { name: 'source.zip' })
  if (outputPdf) archive.append(outputPdf, { name: 'output.pdf' })
  archive.finalize()
  await finished
  const filename = `${String(template.name || 'template').replace(/[/:*?"<>|\s]+/g, '_')}_v${template.version}.bundle.zip`
  return {
    buffer: Buffer.concat(chunks),
    filename,
    contentType: 'application/zip',
  }
}

/**
 * R6 item 5 (2026-08-29): rich bundle validation.
 * Checks EVERYTHING before anything is added so the importer gets a
 * complete, fixable issue list back (the old code rejected on the first
 * problem with an opaque 400/403 message).
 * Returns { issues, meta, doc } — issues is [] when the bundle is importable.
 */
class BundleValidationIssuesError extends Error {
  constructor(issues) {
    super('Bundle validation failed')
    this.name = 'BundleValidationIssuesError'
    this.status = 422
    this.issues = issues
  }
}

const BUNDLE_MAX_NAME = 150
const BUNDLE_MAX_DESC = 4096
const BUNDLE_MAX_FIELD = 512
const BUNDLE_MAX_DOWNLOAD_BYTES = 9 * 1024 * 1024

function _categoryKey(value) {
  return String(value || '').trim().replace(/^\/templates\//, '')
}

async function _listSiteCategories(fallbackSettings) {
  try {
    const section = await SiteSettingsManager.getSection('templates', fallbackSettings)
    return Array.isArray(section.categories) ? section.categories : []
  } catch (err) {
    logger.warn({ err }, 'bundle validation: could not load site categories (skipping category checks)')
    return null
  }
}

async function _innerZipEntryNames(buf) {
  try {
    const { listZipEntryNames } = await import('./_bundleZip.mjs')
    return { names: await listZipEntryNames(buf) }
  } catch (err) {
    return { names: null, error: err }
  }
}

async function validateTemplateBundle(bundle, { privileged }) {
  const issues = []
  const cats = await _listSiteCategories(settings)
  const metaRaw = bundle.get('template.json')
  const sourceRaw = bundle.get('source.zip')
  const pdfRaw = bundle.get('output.pdf')

  if (!metaRaw) issues.push('The bundle does not contain "template.json" (the template metadata file).')
  if (!sourceRaw) issues.push('The bundle does not contain "source.zip" (the LaTeX project source).')
  if (!metaRaw || !sourceRaw) return { issues, meta: null, doc: null }

  let meta
  try {
    meta = JSON.parse(metaRaw.toString('utf8'))
  } catch (err) {
    issues.push('"template.json" is not valid JSON.')
    return { issues, meta: null, doc: null }
  }
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    issues.push('"template.json" must be a JSON object.')
    return { issues, meta, doc: null }
  }

  const doc = {
    name: String(meta.name || '').trim(),
    categoryKey: _categoryKey(meta.category),
    descriptionMD: String(meta.descriptionMD || ''),
    authorMD: String(meta.authorMD || ''),
    license: String(meta.license || '').trim() || 'CC-BY 4.0',
    mainFile: String(meta.mainFile || 'main.tex'),
    compiler: String(meta.compiler || settings.defaultLatexCompiler),
    imageName: meta.imageName || null,
    language: meta.language || null,
  }
  // Canonical storage form (the gallery queries category = '/templates/<key>').
  doc.category = doc.categoryKey ? '/templates/' + doc.categoryKey : ''

  if (!doc.name) {
    issues.push('template.json: "name" is missing or empty.')
  } else if (doc.name.length > BUNDLE_MAX_NAME) {
    issues.push(`template.json: "name" is ${doc.name.length} characters (maximum ${BUNDLE_MAX_NAME}).`)
  }

  if (!doc.categoryKey) {
    issues.push('template.json: "category" is missing or empty (expected an enabled category key, e.g. "theses").')
  } else if (cats === null) {
    // category service unavailable — do not block import on our own outage
  } else {
    const cat = cats.find(c => c.key === doc.categoryKey)
    if (!cat) {
      const known = cats.map(c => c.key).join(', ')
      issues.push(
        `template.json: "category" "${doc.categoryKey}" is not a template category on this site. Known categories: ${known || 'none'}.`
      )
    } else if (!cat.enabled) {
      issues.push(
        `template.json: category "${cat.name}" (${doc.categoryKey}) exists but is disabled — enable it in the admin console (Manage Site → Templates) or pick an enabled category.`
      )
    } else if (!privileged && cat.publishable === false) {
      issues.push(
        `template.json: non-admin users may not publish templates in "${cat.name}" (the site has publishable=false for that category).`
      )
    }
  }

  if (doc.descriptionMD.length > BUNDLE_MAX_DESC) {
    issues.push(`template.json: "descriptionMD" is ${doc.descriptionMD.length} characters (maximum ${BUNDLE_MAX_DESC}).`)
  }
  if (doc.authorMD.length > BUNDLE_MAX_FIELD) {
    issues.push(`template.json: "authorMD" is ${doc.authorMD.length} characters (maximum ${BUNDLE_MAX_FIELD}).`)
  }
  if (doc.license.length > BUNDLE_MAX_FIELD) {
    issues.push(`template.json: "license" is ${doc.license.length} characters (maximum ${BUNDLE_MAX_FIELD}).`)
  }

  const inner = await _innerZipEntryNames(sourceRaw)
  if (inner.names === null) {
    issues.push('"source.zip" is not a valid ZIP archive.')
  } else {
    const base = doc.mainFile.split('/').pop()
    const found = inner.names.some(
      n => n === doc.mainFile || n.split('/').pop() === base
    )
    if (!found) {
      const sample = inner.names.slice(0, 6).join(', ')
      issues.push(
        `template.json: mainFile "${doc.mainFile}" was not found inside source.zip (entries: ${sample}${inner.names.length > 6 ? ', …' : ''}).`
      )
    }
  }

  if (pdfRaw) {
    const head = pdfRaw.length >= 5 ? pdfRaw.subarray(0, 5).toString('latin1') : ''
    if (head !== '%PDF-') {
      issues.push('"output.pdf" does not look like a valid PDF (missing %PDF header) — it will not render as a preview.')
    }
  }

  return { issues, meta, doc }
}

/**
 * 3b (2026-08-28), R6 item 5 (2026-08-29): import a template bundle
 * (template.json + source.zip + optional output.pdf).
 * Validated thoroughly FIRST; all problems are reported at once (422 + issues).
 */
async function importTemplateBundle({ data, userId, override, privileged = false }) {
  const { readZipEntries } = await import('./_bundleZip.mjs')
  let bundle
  try {
    bundle = await readZipEntries(data)
  } catch (err) {
    throw new BundleValidationIssuesError([err.message || 'The file is not a valid ZIP archive.'])
  }
  // R11 item 10 (2026-08-30): return the validated-bundle result — without
  // this `return` the controller received `undefined` and crashed with
  // 500 "Cannot read properties of undefined (reading 'templateId')" on
  // every SUCCESSFUL import (the template itself had already been saved).
  return await _importValidatedBundle({ bundle, userId, override, privileged })
}

/**
 * R6 item 5 (2026-08-29): import a bundle from a URL.
 * The URL is checked against the External URLs site policy (allowed
 * resources regex + blocked private networks), and each redirect hop is
 * re-checked, so a "public" URL cannot be used to pull an internal one.
 */
async function importTemplateBundleFromUrl({ url, userId, override, privileged = false }) {
  const UrlPolicy = await import('../../../../app/src/Features/LinkedFiles/UrlPolicy.mjs')
  const UrlAgent = await import('../../../../app/src/Features/LinkedFiles/UrlAgent.mjs')
  const section = await SiteSettingsManager.getSection('externalUrl', settings)
  let targetUrl
  try {
    targetUrl = new URL(url).toString()
  } catch (err) {
    throw new BundleValidationIssuesError(['The URL is not a valid absolute http(s) URL.'])
  }
  if (!/^https?:$/.test(new URL(targetUrl).protocol)) {
    throw new BundleValidationIssuesError(['The URL must use http or https.'])
  }
  let policyError = null
  try {
    await UrlPolicy.assertUrlAllowed(targetUrl, section)
  } catch (err) {
    policyError = err
  }
  if (policyError) {
    throw new BundleValidationIssuesError([
      policyError.message || 'The URL is not allowed by the site policy.',
    ])
  }

  const response = await UrlAgent.default
    .fetchWithPolicyRedirects(targetUrl, section)
    .then(stream => stream)
    .catch(err => {
      throw new OError(`Could not download the bundle from ${targetUrl}: ${err.message || 'fetch failed'}`, { status: 502 }).withCause(err)
    })

  const chunks = []
  let total = 0
  for await (const chunk of response) {
    total += chunk.length
    if (total > BUNDLE_MAX_DOWNLOAD_BYTES) {
      throw new BundleValidationIssuesError([
        `The remote bundle is larger than ${BUNDLE_MAX_DOWNLOAD_BYTES / 1024 / 1024} MB — too large to import.`,
      ])
    }
    chunks.push(chunk)
  }
  if (total === 0) {
    throw new BundleValidationIssuesError(['The URL returned an empty body (expected a .zip bundle).'])
  }
  return await _importValidatedBundle({
    bundle: null,
    buffer: Buffer.concat(chunks),
    userId,
    override,
    privileged,
  })
}

async function _importValidatedBundle({ bundle, buffer, userId, override, privileged = false }) {
  const { readZipEntries } = await import('./_bundleZip.mjs')
  const bundleMap = bundle ?? (await readZipEntries(buffer))
  const { issues, doc: vdoc } = await validateTemplateBundle(bundleMap, { privileged })
  if (issues.length) throw new BundleValidationIssuesError(issues)
  const doc = { ...vdoc }
  validateTemplateInput(doc)
  await renderTemplateHtmlFields(doc)

  const existing = await Template.findOne({ name: doc.name }).exec()
  if (existing) {
    const { canOverride } = await canUserOverrideTemplate(existing, userId)
    if (!override || !canOverride) {
      throw new TemplateNameConflictError(String(existing.owner))
    }
  }

  const sourceBuf = bundleMap.get('source.zip')
  const pdfRaw = bundleMap.get('output.pdf')

  let template
  if (existing) {
    Object.assign(existing, doc, {
      version: (existing.version || 1) + 1,
      lastUpdated: new Date(),
    })
    template = existing
  } else {
    template = new Template(doc)
    template.owner = userId
  }
  const version = template.version
  const { zip: zipUrl, pdf: pdfUrl } = _bundleAssetUrls(String(template._id), version)
  const [zipRes, pdfRes] = await Promise.all([
    fetchStreamWithResponse(zipUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: sourceBuf,
      signal: AbortSignal.timeout(TIMEOUT),
    }),
    pdfRaw
      ? fetchStreamWithResponse(pdfUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: pdfRaw,
          signal: AbortSignal.timeout(TIMEOUT),
        })
      : Promise.resolve({ response: { status: 200, ok: true } }),
  ])
  if (zipRes.response.status !== 200 || pdfRes.response.status !== 200) {
    if (!existing) {
      await Template.deleteOne({ _id: template._id }).catch(() => {})
    }
    throw new OError('Failed to store template assets', { status: 502 })
  }
  await template.save()
  if (existing) {
    // fire-and-forget previous-version asset cleanup (same pattern as create)
    void deleteTemplateAssets(template._id, version - 1, false)
  }
  return { templateId: String(template._id), version, created: !existing }
}

export { getEnabledCategories, getTemplateBundle, importTemplateBundle, importTemplateBundleFromUrl, validateTemplateBundle, BundleValidationIssuesError }

export default {
  createTemplateFromProject,
  editTemplate,
  deleteTemplate,
  getEnabledCategories,
  getTemplate,
  getCategoryTemplates,
  fetchTemplatePreview,
  getTemplatesPageData,
  getTemplateBundle,
  importTemplateBundle,
  importTemplateBundleFromUrl,
  validateTemplateBundle,
}
