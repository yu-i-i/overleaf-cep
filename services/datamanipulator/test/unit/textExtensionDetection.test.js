import { describe, it, expect } from 'vitest'
import { URL } from 'url'

describe('textExtensions', () => {
  it('module loads successfully', async () => {
    const path = new URL('../../app/src/textExtensions.mjs', import.meta.url)
    const mod = await import(path.pathname)
    
    expect(mod).toBeDefined()
    expect(typeof mod.getTextExtensions).toBe('function')
    expect(typeof mod.isTextExtension).toBe('function')
  })

  it('getTextExtensions returns a Set of text extensions', async () => {
    const path = new URL('../../app/src/textExtensions.mjs', import.meta.url)
    const { getTextExtensions } = await import(path.pathname)
    
    const extensions = getTextExtensions()
    
    expect(extensions).toBeInstanceOf(Set)
    expect(extensions.size).toBeGreaterThan(0)
  })

  it('isTextExtension detects tex files as text', async () => {
    const path = new URL('../../app/src/textExtensions.mjs', import.meta.url)
    const { isTextExtension } = await import(path.pathname)
    
    expect(isTextExtension('main.tex')).toBe(true)
    expect(isTextExtension('chapter.tex')).toBe(true)
  })

  it('isTextExtension is case-insensitive for extensions', async () => {
    const path = new URL('../../app/src/textExtensions.mjs', import.meta.url)
    const { isTextExtension } = await import(path.pathname)
    
    expect(isTextExtension('file.TEX')).toBe(true)
    expect(isTextExtension('file.Tex')).toBe(true)
  })
})
