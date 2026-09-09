/**
 * test/unit/unit-env.mjs — MUST be the FIRST setupFile.
 *
 * 2026-08-31 (P0): unit tests must never bind the live `sharelatex` Mongo
 * database. `@overleaf/settings` resolves `Settings.mongo.url` from
 * `process.env.MONGO_URL` with the production default
 * (`mongodb://127.0.0.1/sharelatex`), and in the shared vitest worker
 * (`isolate: false`) the first import of the web stack — via ANY test
 * file's hoisted static imports, before that file's own env lines run —
 * binds the singleton for the whole process.
 *
 * This file has NO imports (ESM static imports are hoisted before any
 * module body runs), so it is the only place that can guarantee MONGO_URL
 * exists before anything else in the worker evaluates.
 */
if (!process.env.MONGO_URL) {
  process.env.MONGO_URL = 'mongodb://127.0.0.1:27017/overleaf-unit-test'
}
// MONGO_HOST/MONGO_DATABASE are part of the overleaf server environment
// (they can point at the LIVE database) and are a fallback the settings
// layer consults when MONGO_URL is absent; neutralize them for unit tests.
process.env.MONGO_HOST = process.env.MONGO_HOST || '127.0.0.1'
process.env.MONGO_DATABASE = process.env.MONGO_DATABASE || 'overleaf-unit-test'
if (!process.env.NODE_APP_INSTANCE) {
  process.env.NODE_APP_INSTANCE = String(
    Math.floor(Math.random() * 100000)
  )
}
