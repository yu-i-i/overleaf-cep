import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    projects: [
      {
        test: {
          name: 'hooks',
          environment: 'jsdom',
          include: ['test/project-linked-files/hooks.test.ts'],
        },
      },
      {
        test: {
          name: 'agents',
          setupFiles: ['test/unit/bootstrap.mjs'],
          include: [
            'test/unit/src/LinkedFiles/ProjectFileAgent.test.mjs',
            'test/unit/src/LinkedFiles/ProjectOutputFileAgent.test.mjs',
          ],
        },
      },
    ],
  },
})
