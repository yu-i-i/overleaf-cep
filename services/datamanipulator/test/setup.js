import { vi } from 'vitest'

// Mock Settings module before any imports happen
vi.mock('@overleaf/settings', () => ({
  default: {
    textExtensions: ['tex', 'latex', 'sty', 'cls', 'txt']
  },
  Settings: {
    textExtensions: ['tex', 'latex', 'sty', 'cls', 'txt']
  }
}))
