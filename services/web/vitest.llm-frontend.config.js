/*
 * Standalone vitest harness for LLM-module frontend render tests.
 *
 * Why a separate config: the main vitest config has no `@/` / `@overleaf/*`
 * aliases (backend-only test suites) and no React global (the webpack build
 * injects React via ProvidePlugin; vitest does not).
 *
 * Usage (from services/web):
 *   NODE_ENV=development ./node_modules/.bin/vitest run --config vitest.llm-frontend.config.js
 */
module.exports = {
  resolve: {
    alias: [
      { find: /^@\//, replacement: __dirname + '/frontend/js/' },
      { find: /^@overleaf\/(.*)/, replacement: __dirname + '/../../libraries/$1' },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/unit/src/llm-vitest-setup.mjs'],
    globals: true,
    include: ['test/unit/src/llm-*-render.test.mjs'],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
}
