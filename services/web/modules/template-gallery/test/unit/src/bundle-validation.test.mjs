import { describe, it, beforeAll, afterAll } from 'vitest'
import { strict as assert } from 'node:assert'

process.env.NODE_ENV = 'test'
process.env.MONGO_URL = 'mongodb://127.0.0.1:27017/template-gallery-unit'
process.env.NODE_APP_INSTANCE = String(Math.floor(Math.random() * 10000))

import { readZipEntries } from '../../../app/src/_bundleZip.mjs'
import { validateTemplateBundle, BundleValidationIssuesError } from '../../../app/src/TemplateGalleryManager.mjs'
import * as SiteSettingsManagerModule from '../../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import archiver from 'archiver'

function makeZip(files) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const archive = archiver('zip')
    archive.on('data', c => chunks.push(c))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name })
    }
    archive.finalize()
  })
}

async function makeBundle(meta, files, extra) {
  const sourceZip = await makeZip(Object.fromEntries(files.map(f => [f, 'fake tex content'])))
  const all = { 'template.json': JSON.stringify(meta), 'source.zip': sourceZip, ...extra }
  const zip = await makeZip(all)
  return readZipEntries(zip)
}

describe('validateTemplateBundle (R6 item 5)', () => {
  beforeAll(async () => {
    // clean slate: drop any stored site_settings from earlier runs
    const Mongoose = await import('../../../../../app/src/infrastructure/Mongoose.mjs')
    if (Mongoose.default.connection.readyState) {
      await Mongoose.default.connection.db.collection('site_settings').deleteMany({ _id: 'global' })
    }
    SiteSettingsManagerModule.invalidateCache()
  })

  afterAll(async () => {
    const Mongoose = await import('../../../../../app/src/infrastructure/Mongoose.mjs')
    if (Mongoose.default.connection.readyState) {
      await Mongoose.default.connection.db.collection('site_settings').deleteMany({ _id: 'global' })
    }
    SiteSettingsManagerModule.invalidateCache()
  })

  it('rejects a plain zip that is missing template.json and source.zip with both issues', async () => {
    const zip = await makeZip({ 'unrelated.txt': 'hi' })
    const bundle = await readZipEntries(zip)
    const { issues } = await validateTemplateBundle(bundle, { privileged: false })
    assert.ok(issues.length >= 2)
    assert.ok(issues.some(i => i.includes('template.json')))
    assert.ok(issues.some(i => i.includes('source.zip')))
  })

  it('rejects invalid template.json and reports the JSON problem', async () => {
    const sourceZip = await makeZip({ 'main.tex': 'content' })
    const zip = await makeZip({ 'template.json': '{ not json', 'source.zip': sourceZip })
    const bundle = await readZipEntries(zip)
    const { issues } = await validateTemplateBundle(bundle, { privileged: false })
    assert.ok(issues.some(i => i.includes('valid JSON')))
  })

  it('accepts a valid bundle (enabled category, mainFile present)', async () => {
    const bundle = await makeBundle(
      {
        name: 'Unit Test Template',
        category: 'all',
        descriptionMD: 'desc',
        authorMD: 'author',
        license: 'CC-BY 4.0',
        mainFile: 'main.tex',
      },
      ['main.tex']
    )
    const { issues, doc } = await validateTemplateBundle(bundle, { privileged: true })
    assert.equal(issues.length, 0)
    assert.equal(doc.name, 'Unit Test Template')
    assert.equal(doc.category, '/templates/all')
  })

  it('accepts category given as /templates/<key> (normalises to canonical form)', async () => {
    const bundle = await makeBundle(
      { name: 'T2', category: '/templates/all', mainFile: 'main.tex' },
      ['main.tex']
    )
    const { issues, doc } = await validateTemplateBundle(bundle, { privileged: true })
    assert.equal(issues.length, 0)
    assert.equal(doc.category, '/templates/all')
  })

  it('rejects an unknown category with the list of known categories', async () => {
    const bundle = await makeBundle(
      { name: 'T3', category: 'no-such-cat', mainFile: 'main.tex' },
      ['main.tex']
    )
    const { issues } = await validateTemplateBundle(bundle, { privileged: true })
    assert.ok(issues.some(i => i.includes('no-such-cat') && i.includes('not a template category')))
  })

  it('rejects missing name, oversize name, missing mainFile, and bad PDF — all at once', async () => {
    const bundle = await makeBundle(
      {
        name: 'x'.repeat(200),
        category: 'all',
        mainFile: 'main.tex',
      },
      ['other.tex'],
      { 'output.pdf': 'not a pdf' }
    )
    const { issues } = await validateTemplateBundle(bundle, { privileged: true })
    assert.ok(issues.some(i => i.includes('"name" is 200 characters')))
    assert.ok(issues.some(i => i.includes('mainFile') && i.includes('not found')))
    assert.ok(issues.some(i => i.includes('"output.pdf"')))
  })

  // Extra timeout: when this file shares a vitest worker with other mongo
  // suites, the first connect for this DB can be slow (stale/duplicate
  // client reconnect) — well under 20s in practice.
  it('applies the category publishable check for non-privileged importers', async () => {
    const SiteSettingsManager = SiteSettingsManagerModule
    await SiteSettingsManager.setSection('templates', {
      enabled: true,
      categories: [
        { key: 'all', name: 'All templates', enabled: true, publishable: false },
      ],
    })
    SiteSettingsManager.invalidateCache()
    const bundle = await makeBundle(
      { name: 'T4', category: 'all', mainFile: 'main.tex' },
      ['main.tex']
    )
    const { issues } = await validateTemplateBundle(bundle, { privileged: false })
    assert.ok(issues.some(i => i.includes('publishable')))
    // privileged importers bypass the publishable restriction
    const { issues: privIssues } = await validateTemplateBundle(bundle, { privileged: true })
    assert.ok(!privIssues.some(i => i.includes('publishable')))
  }, 20000)

  it('exposes a 422 status on the issues error', () => {
    const err = new BundleValidationIssuesError(['a'])
    assert.equal(err.status, 422)
    assert.deepEqual(err.issues, ['a'])
  })
})
