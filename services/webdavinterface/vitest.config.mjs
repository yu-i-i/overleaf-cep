import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    environmentOptions: {
      node: {
        globals: true
      }
    }
  }
})
