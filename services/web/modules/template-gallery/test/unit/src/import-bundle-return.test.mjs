import { vi } from 'vitest'
import { describe, it, beforeAll, afterAll } from 'vitest'
import { strict as assert } from 'node:assert'

process.env.NODE_ENV = 'test'
process.env.MONGO_URL = 'mongodb://127.0.0.1:27017/template-gallery-unit'
process.env.NODE_APP_INSTANCE = String(Math.floor(Math.random() * 10000))

// The filestore asset upload goes over HTTP in production; in unit tests we
// stub it (no web-service/filestore available in the unit environment).
vi.mock('@overleaf/fetch-utils', () => ({
  fetchStreamWithResponse: async () => ({ response: { status: 200, ok: true } }),
}))

import { importTemplateBundle } from '../../../app/src/TemplateGalleryManager.mjs'
import { Template } from '../../../app/src/models/Template.mjs'
import archiver from 'archiver'

const FAKE_UID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const TEST_NAME = `r11-import-return-${Date.now()}`

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

describe('importTemplateBundle return contract (R11 item 10 regression)', () => {
  afterAll(async () => {
    await Template.deleteMany({ name: TEST_NAME }).catch(() => {})
  })

  it('RESOLVES to { templateId, version, created } — not undefined', async () => {
    // R11 item 10 (2026-08-30): the wrappers `importTemplateBundle` /
    // `importTemplateBundleFromUrl` dropped the promise result of
    // `_importValidatedBundle`, so the controller crashed with
    // 500 "Cannot read properties of undefined (reading 'templateId')" on
    // EVERY successful bundle import — the template silently existed, the
    // user saw a server error (exactly the reported flow: download bundle,
    // delete template, import the bundle back).
    const sourceZip = await makeZip({ 'main.tex': '\\documentclass{article}\\begin{document}hi\\end{document}' })
    const zip = await makeZip({
      'template.json': JSON.stringify({
        name: TEST_NAME,
        version: 1,
        category: 'thesis',
        descriptionMD: 't',
        authorMD: 'u',
        license: 'CC-BY 4.0',
      }),
      'source.zip': sourceZip,
    })
    const result = await importTemplateBundle({ data: zip, userId: FAKE_UID, override: true })

    assert.ok(
      result && typeof result === 'object',
      'importTemplateBundle must return the _importValidatedBundle result object (was undefined → controller 500)'
    )
    assert.equal(typeof result.templateId, 'string')
    assert.ok(result.templateId.length > 0)
    assert.equal(result.version, 1)
    assert.equal(result.created, true)

    // the side effect really happened
    const saved = await Template.findById(result.templateId)
    assert.ok(saved)
    assert.equal(saved.name, TEST_NAME)
    assert.equal(String(saved.owner), FAKE_UID)
  })
})
