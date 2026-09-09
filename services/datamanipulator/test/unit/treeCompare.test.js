import { describe, it, expect, beforeAll } from 'vitest'
import { URL } from 'url'

describe('compareTrees (I.1 — M6 unknown class + D2 excluded paths)', () => {
  let compareTrees

  beforeAll(async () => {
    const path = new URL('../../app/src/treeCompare.mjs', import.meta.url)
    const mod = await import(path.pathname)
    compareTrees = mod.compareTrees
  })

  const entry = (relative_path, { checksum, size, type = 'file' } = {}) =>
    ({ relative_path, checksum: checksum ?? null, size, type })

  it('(a) equal-size no-checksum pair classifies as unknown, NOT identical', () => {
    const left = { entries: [entry('notes.txt', { size: 100 })] }
    const right = { entries: [entry('notes.txt', { size: 100 })] }
    const result = compareTrees(left, right)

    expect(result.unknown).toHaveLength(1)
    expect(result.unknown[0].path).toBe('notes.txt')
    expect(result.unknown[0].size).toBe(100)
    expect(result.unknown[0].note).toMatch(/checksums unavailable/i)
    expect(result.identical).toHaveLength(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('(b) size mismatch without checksums classifies as conflict', () => {
    const left = { entries: [entry('notes.txt', { size: 100 })] }
    const right = { entries: [entry('notes.txt', { size: 250 })] }
    const result = compareTrees(left, right)

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].path).toBe('notes.txt')
    expect(result.conflicts[0].leftSize).toBe(100)
    expect(result.conflicts[0].rightSize).toBe(250)
    expect(result.unknown).toHaveLength(0)
    expect(result.identical).toHaveLength(0)
  })

  it('(c) sync-excluded paths are dropped from both sides (never added/removed/changed/identical/unknown)', () => {
    const excludedLeft = {
      entries: [
        entry('main.tex', { checksum: 'abc', size: 10 }),
        entry('main.aux', { checksum: 'def', size: 20 }),
        entry('.DS_Store', { checksum: 'ghi', size: 30 }),
        entry('out/x.synctex.gz', { checksum: 'jkl', size: 40 }),
      ],
    }
    const excludedRight = {
      entries: [
        entry('main.tex', { checksum: 'abc', size: 10 }),
        // excluded entries with different content on the right — must not
        // surface as conflicts/onlyInRight
        entry('main.aux', { checksum: 'other', size: 999 }),
        entry('.git/config', { checksum: 'qqq', size: 5 }),
        entry('out/x.synctex.gz', { checksum: 'mmm', size: 1 }),
      ],
    }
    const result = compareTrees(excludedLeft, excludedRight)

    const all = [
      ...result.conflicts,
      ...result.onlyInLeft,
      ...result.onlyInRight,
      ...result.identical,
      ...result.unknown,
    ].map(e => e.path ?? e.relative_path)

    expect(all).toEqual(['main.tex'])
    expect(result.identical).toHaveLength(1)
    expect(result.conflicts).toHaveLength(0)
  })

  it('checksummed pairs still classify identical/conflict normally', () => {
    const left = { entries: [entry('a.tex', { checksum: '1', size: 5 }), entry('b.tex', { checksum: '2', size: 6 })] }
    const right = { entries: [entry('a.tex', { checksum: '1', size: 5 }), entry('b.tex', { checksum: '9', size: 6 })] }
    const result = compareTrees(left, right)
    expect(result.identical).toHaveLength(1)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].path).toBe('b.tex')
  })
})
