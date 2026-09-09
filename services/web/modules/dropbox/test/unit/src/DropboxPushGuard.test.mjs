import { describe, expect, it, vi } from 'vitest'

// DropboxRouter imports a lot of app-level machinery; none of it is exercised
// by the pure helpers under test here, so stub the heavy modules to keep the
// import graph light and deterministic.
vi.mock('../../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs', () => ({
  default: {
    ensureUserCanWriteProjectContent: () => (req, res, next) => next(),
  },
}))
vi.mock('../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
  default: { promises: { getProject: async () => null } },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/Editor/EditorController.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs', () => ({
  default: { promises: { flushProjectToMongo: async () => true } },
}))
vi.mock('../../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/History/HistoryManager.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../app/models/dropboxUserCredentials.mjs', () => ({
  DropboxUserCredentials: {},
}))
vi.mock('../../../app/models/dropboxSyncProjectStates.mjs', () => ({
  DropboxSyncProjectStates: {},
}))
vi.mock('@overleaf/settings', () => ({ default: {} }))

const {
  joinDisplayPath,
  localOnlyPaths,
  remoteOnlyPaths,
  resolveDisplayRoot,
  shouldApplyRemoteFile,
} = await import('../../../app/src/DropboxRouter.mjs')

describe('remoteOnlyPaths (mirror export: local project wins)', () => {
  const isExcluded = k => k === '.DS_Store' || k.split('/').some(p => p.startsWith('.'))

  it('deletes exactly the remote files absent from the local set', () => {
    const remote = ['/main.tex', 'sample.bib', '/extra/remote-only.png', 'Bla/shot.png']
    const local = ['main.tex', 'sample.bib', '/Bla/shot.png']
    expect(remoteOnlyPaths(remote, local, isExcluded)).toEqual(['extra/remote-only.png'])
  })

  it('never deletes sync-excluded remote entries', () => {
    const remote = ['.hidden/file.txt', '.cache/build.aux', 'main.tex']
    const local = ['main.tex']
    expect(remoteOnlyPaths(remote, local, isExcluded)).toEqual([])
  })

  it('never deletes when the remote set is a subset (nothing to do)', () => {
    expect(remoteOnlyPaths(['a/b.txt'], ['a/b.txt', 'other/c.txt'], isExcluded)).toEqual([])
  })

  it('handles mixed slash styles on both sides', () => {
    expect(remoteOnlyPaths(['/kept/f.txt', '/gone/g.txt'], ['kept/f.txt'], isExcluded)).toEqual([
      'gone/g.txt',
    ])
  })
})

describe('localOnlyPaths (mirror import: remote folder wins)', () => {
  const isExcluded = k => k === '.DS_Store' || k.split('/').some(p => p.startsWith('.'))

  it('deletes exactly the local entries absent from the remote set', () => {
    const local = ['main.tex', 'local-only.txt', '/Bla/shot.png']
    const remote = ['main.tex', 'Bla/shot.png', 'remote-only.txt']
    expect(localOnlyPaths(local, remote, isExcluded)).toEqual(['local-only.txt'])
  })

  it('never deletes a directory that still contains kept files', () => {
    const local = ['folder/keep.txt', 'folder/gone.txt', 'top.txt']
    const remote = ['folder/keep.txt']
    // folder/ has a remote file underneath -> kept; only its local-only child
    // (and nothing else) may go. top.txt is local-only -> deleted.
    expect(localOnlyPaths(local, remote, isExcluded)).toEqual(['folder/gone.txt', 'top.txt'])
  })

  it('deletes a directory only when no remote file lies underneath it', () => {
    const local = ['empty-dir/obsolete.txt']
    const remote = ['main.tex']
    expect(localOnlyPaths(local, remote, isExcluded)).toEqual(['empty-dir/obsolete.txt'])
  })

  it('never targets the project root "/"', () => {
    const local = ['/', 'a.txt']
    const remote = ['main.tex']
    expect(localOnlyPaths(local, remote, isExcluded)).not.toContain('')
    expect(localOnlyPaths(local, remote, isExcluded)).not.toContain('/')
    expect(localOnlyPaths(local, remote, isExcluded)).toEqual(['a.txt'])
  })

  it('never deletes sync-excluded local entries', () => {
    const local = ['main.tex', '.DS_Store', '.hidden/x.png']
    const remote = ['main.tex']
    expect(localOnlyPaths(local, remote, isExcluded)).toEqual([])
  })
})

describe('shouldApplyRemoteFile (import: remote wins, churn guard)', () => {
  const base = {
    previousRev: 'rev-1',
    currentRev: 'rev-2',
    storedHash: 'h-1',
    currentHash: 'h-2',
  }

  it('applies when the local entity is gone (locally deleted -> remote wins)', () => {
    expect(shouldApplyRemoteFile({ ...base, localPresent: false, currentHash: null })).toBe(true)
  })

  it('applies when the remote changed (rev differs) even if local is unchanged', () => {
    expect(
      shouldApplyRemoteFile({ ...base, localPresent: true, currentHash: 'h-1' })
    ).toBe(true)
  })

  it('applies when the local content changed (both sides edited -> remote wins)', () => {
    expect(
      shouldApplyRemoteFile({
        ...base,
        localPresent: true,
        previousRev: 'rev-1',
        currentRev: 'rev-1',
        storedHash: 'h-1',
        currentHash: 'h-2',
      })
    ).toBe(true)
  })

  it('applies when there is no stored baseline yet (first import)', () => {
    expect(
      shouldApplyRemoteFile({
        localPresent: true,
        previousRev: null,
        currentRev: 'rev-1',
        storedHash: null,
        currentHash: 'h-2',
      })
    ).toBe(true)
  })

  it('skips only when both sides are unchanged and the entity is present', () => {
    expect(
      shouldApplyRemoteFile({
        localPresent: true,
        previousRev: 'rev-1',
        currentRev: 'rev-1',
        storedHash: 'h-1',
        currentHash: 'h-1',
      })
    ).toBe(false)
  })
})

describe('joinDisplayPath (BUG1: full Dropbox path for the modal)', () => {
  it('combines the owner root with the project state path (user incident case)', () => {
    expect(joinDisplayPath('Apps/Overleaf Dev', '/A5 test')).toBe(
      'Apps/Overleaf Dev/A5 test'
    )
  })

  it('decodes percent-encoded roots and state paths', () => {
    expect(joinDisplayPath('Apps/Overleaf%20Dev', '/A5%20test')).toBe(
      'Apps/Overleaf Dev/A5 test'
    )
  })

  it('falls back to the state path alone for a plain sandbox root', () => {
    expect(joinDisplayPath('/', '/A5 test')).toBe('A5 test')
    expect(joinDisplayPath(undefined, '/A5 test')).toBe('A5 test')
    expect(joinDisplayPath(null, '/A5 test')).toBe('A5 test')
  })

  it('handles empty state paths without crashing', () => {
    expect(joinDisplayPath('Apps/Overleaf Dev', '')).toBe('')
    expect(joinDisplayPath('Apps/Overleaf Dev', '/')).toBe('')
  })
})

describe('resolveDisplayRoot (app-folder fallback, BUG1 round 2)', () => {
  it('prefers the active-doc path', () => {
    expect(resolveDisplayRoot('My Root', 'Legacy', 'Apps/Overleaf Dev')).toBe('My Root')
  })

  it('falls back to the legacy-doc path when the active doc has none', () => {
    expect(resolveDisplayRoot(undefined, 'Apps/Overleaf Dev', 'FB')).toBe('Apps/Overleaf Dev')
  })

  it('treats "/" as unset and uses the app-folder fallback', () => {
    expect(resolveDisplayRoot('/', null, 'Apps/Overleaf Dev')).toBe('Apps/Overleaf Dev')
    expect(resolveDisplayRoot(undefined, undefined, 'Apps/Overleaf Dev')).toBe('Apps/Overleaf Dev')
  })
})
