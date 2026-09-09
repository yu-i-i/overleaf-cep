import { describe, it, expect, beforeAll } from 'vitest'
import { URL } from 'url'

describe('isSyncExcluded (D2 sync filter)', () => {
  let isSyncExcluded

  beforeAll(async () => {
    const path = new URL('../../app/src/fileUtils.mjs', import.meta.url)
    const mod = await import(path.pathname)
    isSyncExcluded = mod.isSyncExcluded
  })

  it('excludes LaTeX build transients', () => {
    expect(isSyncExcluded('main.aux')).toBe(true)
    expect(isSyncExcluded('main.log')).toBe(true)
    expect(isSyncExcluded('main.out')).toBe(true)
    expect(isSyncExcluded('main.toc')).toBe(true)
    expect(isSyncExcluded('main.fls')).toBe(true)
    expect(isSyncExcluded('main.idx')).toBe(true)
    expect(isSyncExcluded('main.vrb')).toBe(true)
    expect(isSyncExcluded('build.synctex.gz')).toBe(true)
    expect(isSyncExcluded('dir/main.synctex.gz')).toBe(true)
    // case-insensitive
    expect(isSyncExcluded('main.AUX')).toBe(true)
  })

  it('excludes hidden files and hidden directory paths', () => {
    expect(isSyncExcluded('.DS_Store')).toBe(true)
    expect(isSyncExcluded('.gitignore')).toBe(true)
    expect(isSyncExcluded('.git/config')).toBe(true)
    expect(isSyncExcluded('.hidden/main.tex')).toBe(true)
  })

  it('keeps regular content files (including bib)', () => {
    expect(isSyncExcluded('main.tex')).toBe(false)
    expect(isSyncExcluded('main.bib')).toBe(false)
    expect(isSyncExcluded('README.md')).toBe(false)
    expect(isSyncExcluded('images/pic.pdf')).toBe(false)
    // node_modules is intentionally NOT in the D2 list (walkTree keeps its
    // existing list-don't-recurse behaviour)
    expect(isSyncExcluded('node_modules/pkg/index.js')).toBe(false)
  })

  it('rejects empty input as excluded', () => {
    expect(isSyncExcluded('')).toBe(true)
    expect(isSyncExcluded(undefined)).toBe(true)
    expect(isSyncExcluded(null)).toBe(true)
  })
})

describe('treeCompare unknown class (M6)', () => {
  let compareTrees

  beforeAll(async () => {
    const path = new URL('../../app/src/treeCompare.mjs', import.meta.url)
    const mod = await import(path.pathname)
    compareTrees = mod.compareTrees
  })

  it('classifies equal-size no-checksum files as unknown, not identical', () => {
    const result = compareTrees(
      { entries: [{ relative_path: 'a.txt', size: 10 }] },
      { entries: [{ relative_path: 'a.txt', size: 10 }] }
    )
    expect(result.identical).toEqual([])
    expect(result.unknown).toHaveLength(1)
    expect(result.unknown[0].path).toBe('a.txt')
    expect(result.conflicts).toEqual([])
  })

  it('keeps size mismatches as conflicts', () => {
    const result = compareTrees(
      { entries: [{ relative_path: 'a.txt', size: 10 }] },
      { entries: [{ relative_path: 'a.txt', size: 20 }] }
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.unknown).toEqual([])
  })

  it('drops sync-excluded entries from both sides', () => {
    const result = compareTrees(
      {
        entries: [
          { relative_path: 'main.tex', size: 5, checksum: 'sha256:x' },
          { relative_path: 'main.aux' }
        ]
      },
      { entries: [{ relative_path: 'main.tex', size: 6, checksum: 'sha256:y' }] }
    )
    expect(result.onlyInLeft).toEqual([])
    expect(result.conflicts.map(c => c.path)).toEqual(['main.tex'])
  })
})
