import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/unit/bootstrap.mjs'],
    globals: true,
    passWithNoTests: true
  }
})
