import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
export default defineConfig({
  root,
  resolve: { alias: { '@': `${root}/frontend/js` } },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['modules/llm/test/*.test.tsx'],
  },
})
