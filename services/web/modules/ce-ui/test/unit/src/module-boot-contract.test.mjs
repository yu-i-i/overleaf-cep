import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Module boot contract guard (2026-08-31).
 *
 * `Modules.mjs` does `loadedModule.name = moduleName` on every module in
 * `moduleImportSequence`. The object must be EXTENSIBLE — an `export {}`
 * ESM namespace is frozen, which crash-loops the web server at boot:
 *   TypeError: Cannot add property name, object is not extensible
 * (caught live on 2026-08-31 when ce-ui shipped as `export {}`).
 *
 * Every module entry therefore needs a default-exported object. This test
 * statically asserts the marker for all present modules (no server boot
 * required).
 */
const MODULES_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..')

function listModules() {
  return readdirSync(MODULES_ROOT).filter(
    name =>
      !name.startsWith('.') &&
      existsSync(path.join(MODULES_ROOT, name, 'index.mjs'))
  )
}

describe('module boot contract (extensible default export)', () => {
  it('every module index.mjs declares an export default (extensible object)', () => {
    const mods = listModules()
    assert.ok(mods.length >= 7, `expected the fork modules, saw: ${mods.join(', ')}`)
    for (const name of mods) {
      const src = readFileSync(path.join(MODULES_ROOT, name, 'index.mjs'), 'utf8')
      assert.ok(
        /\bexport\s+default\b/.test(src),
        `${name}/index.mjs lacks "export default" — Modules.mjs would attach .name to a frozen namespace and crash the web boot`
      )
    }
  })
})
