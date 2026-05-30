import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.doMock('@overleaf/logger', () => ({
    default: {
      debug() {},
      log() {},
      info() {},
      warn() {},
      error() {},
      err() {},
    },
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})
