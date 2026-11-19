import { describe, it, expect } from 'vitest'
import { createReadService } from '../../app/src/PersonalMcpReadService.mjs'

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa'


async function expectRejection(promise, code) {
  try {
    await promise
  } catch (err) {
    expect(err.code).toEqual(code)
    return
  }
  throw new Error(`expected rejection with code ${code}`)
}

function forbiddenError(code) {
  const err = new Error('denied')
  err.code = code
  return err
}

function makeService(overrides = {}) {
  const calls = { getDoc: 0, findDoc: [] }
  const deps = {
    findProjects: async () => ({
      owned: [{ _id: 'p1', name: 'Mine' }],
      readAndWrite: [{ _id: 'p2', name: 'Collab' }],
      readOnly: [{ _id: 'p3', name: 'ReadOnly' }],
      review: [],
    }),
    canRead: async (userId, projectId) => projectId !== 'p3',
    getProject: async projectId => {
      if (projectId === 'missing') return null
      return {
        _id: projectId,
        rootFolder: [
          {
            _id: 'f0',
            name: 'root',
            docs: [{ _id: 'd1', name: 'main.tex' }],
            folders: [
              {
                _id: 'f1',
                name: 'sub',
                docs: [{ _id: 'd2', name: 'refs.bib' }],
                folders: [],
              },
            ],
          },
        ],
      }
    },
    findDoc: async (project, docId) => {
      calls.findDoc.push([project._id, docId])
      if (docId === 'other-project-doc') {
        throw forbiddenError('DOC_NOT_FOUND')
      }
      return { _id: docId }
    },
    getDoc: async () => {
      calls.getDoc++
      return { lines: ['line1', 'line2'], version: 'rev42' }
    },
  }
  const service = createReadService({ ...deps, ...overrides })
  return { service, calls }
}

describe('PersonalMcpReadService.listProjects', () => {
  it('returns only projects the user can read, with role', async () => {
    const { service } = makeService()
    const projects = await service.listProjects(USER)
    expect(projects).toEqual([
      { id: 'p1', name: 'Mine', role: 'owned' },
      { id: 'p2', name: 'Collab', role: 'readAndWrite' },
    ])
  })
})

describe('PersonalMcpReadService.listDocs', () => {
  it('denies a project the user cannot read', async () => {
    const { service } = makeService()
    await expectRejection(service.listDocs(USER, 'p3'), 'FORBIDDEN')
  })

  it('lists nested docs with paths', async () => {
    const { service } = makeService()
    expect(await service.listDocs(USER, 'p1')).toEqual([
      { id: 'd1', path: '/main.tex' },
      { id: 'd2', path: '/sub/refs.bib' },
    ])
  })

  it('errors for a nonexistent project', async () => {
    const { service } = makeService()
    await expectRejection(service.listDocs(USER, 'missing'), 'PROJECT_NOT_FOUND')
  })
})

describe('PersonalMcpReadService.readDoc', () => {
  it('denies reading a project the user cannot read', async () => {
    const { service, calls } = makeService()
    await expectRejection(service.readDoc(USER, 'p3', 'd1'), 'FORBIDDEN')
    expect(calls.getDoc).toEqual(0)
  })

  it('rejects a doc that does not belong to the given project', async () => {
    const { service, calls } = makeService()
    await expectRejection(service.readDoc(USER, 'p1', 'other-project-doc'), 'DOC_NOT_FOUND')
    expect(calls.getDoc).toEqual(0)
    expect(calls.findDoc).toEqual([['p1', 'other-project-doc']])
  })

  it('reads a doc in a readable project', async () => {
    const { service, calls } = makeService()
    const doc = await service.readDoc(USER, 'p1', 'd1')
    expect(doc).toEqual({ text: 'line1\nline2', version: 'rev42' })
    expect(calls.getDoc).toEqual(1)
  })

  it('errors for a nonexistent project', async () => {
    const { service } = makeService()
    await expectRejection(service.readDoc(USER, 'missing', 'd1'), 'PROJECT_NOT_FOUND')
  })
})
