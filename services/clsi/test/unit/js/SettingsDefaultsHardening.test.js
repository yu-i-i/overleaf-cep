import { expect, describe, it } from 'vitest'
import { createRequire } from 'node:module'
import Path from 'node:path'

const require = createRequire(import.meta.url)
const settingsPath = Path.join(
  import.meta.dirname,
  '../../../config/settings.defaults.cjs'
)

function loadSettingsWithEnv(env) {
  const oldEnv = process.env
  delete require.cache[require.resolve(settingsPath)]
  process.env = { ...env }
  try {
    return require(settingsPath)
  } finally {
    process.env = oldEnv
    delete require.cache[require.resolve(settingsPath)]
  }
}

describe('settings defaults hardening', () => {
  it('should parse comma and whitespace separated allowed images', () => {
    const settings = loadSettingsWithEnv({})
    expect(
      settings._openleafHardening.parseImageList(
        'repo/tex:2025.1 repo/tex:2024.1,repo/tex:2023.1'
      )
    ).to.deep.equal(['repo/tex:2025.1', 'repo/tex:2024.1', 'repo/tex:2023.1'])
  })

  it('should fail closed when sandboxed compiles have no image allow-list', () => {
    expect(() =>
      loadSettingsWithEnv({
        SANDBOXED_COMPILES: 'true',
      })
    ).to.throw('Sandboxed compiles require an explicit TeX image allow-list')
  })

  it('should require the default image to be allowed', () => {
    expect(() =>
      loadSettingsWithEnv({
        SANDBOXED_COMPILES: 'true',
        TEX_LIVE_DOCKER_IMAGE: 'repo/tex:2025.1',
        ALLOWED_IMAGES: 'repo/tex:2024.1',
      })
    ).to.throw('Default TeX image repo/tex:2025.1 is not present')
  })
})
