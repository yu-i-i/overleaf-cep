import { describe, it, expect } from 'vitest'
import {
  createDispatcher,
  createMcpMiddleware,
} from '../../app/src/PersonalMcpServer.mjs'

const USER = '507f1f77bcf86cd799439011'
const P1 = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const P2 = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const D1 = 'cccccccccccccccccccccccc'
const D2 = 'dddddddddddddddddddddddd'

function fakeReadService() {
  const calls = []
  return {
    calls,
    async listProjects(userId) {
      calls.push(['list_projects', userId])
      return [{ id: P1, name: 'Mine', role: 'owned' }]
    },
    async listDocs(userId, projectId) {
      calls.push(['list_docs', userId, projectId])
      if (projectId === P2) {
        throw Object.assign(new Error('denied'), { code: 'FORBIDDEN' })
      }
      return [{ id: D1, path: '/main.tex' }]
    },
    async readDoc(userId, projectId, docId) {
      calls.push(['read_doc', userId, projectId, docId])
      if (projectId === P2) {
        throw Object.assign(new Error('denied'), { code: 'FORBIDDEN' })
      }
      if (docId === D2) {
        throw Object.assign(new Error('nope'), { code: 'DOC_NOT_FOUND' })
      }
      return { text: 'hello', version: 'rev1' }
    },
  }
}

function setup() {
  const readService = fakeReadService()
  const dispatch = createDispatcher({ readService })
  return { readService, dispatch }
}

function toolText(body) {
  return body.result.content[0].text
}

describe('MCP dispatcher', () => {
  it('initializes with a supported protocol version', async () => {
    const { dispatch } = setup()
    const out = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} },
    })
    expect(out.status).toEqual(200)
    expect(out.body.result.protocolVersion).toEqual('2024-11-05')
    expect(out.body.result.capabilities.tools).toBeDefined()
    expect(out.body.result.serverInfo.name).toEqual('overleaf-personal-mcp')
    const fallback = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '9999-99-99' },
    })
    expect(fallback.body.result.protocolVersion).toEqual('2025-06-18')
  })

  it('answers ping and tools/list', async () => {
    const { dispatch } = setup()
    const ping = await dispatch(USER, { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(ping.body.result).toEqual({})
    const list = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(list.body.result.tools.map(t => t.name)).toEqual([
      'list_projects',
      'list_docs',
      'read_doc',
    ])
    for (const tool of list.body.result.tools) {
      expect(tool.inputSchema.type).toEqual('object')
    }
  })

  it('passes the token-derived userId to the read service, never body data', async () => {
    const { dispatch, readService } = setup()
    const out = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_projects', user_id: 'evil-injected-id' },
    })
    expect(out.body.result.isError).toBe(false)
    expect(JSON.parse(toolText(out.body)).projects).toEqual([
      { id: P1, name: 'Mine', role: 'owned' },
    ])
    expect(readService.calls).toEqual([['list_projects', USER]])
  })

  it('validates tool arguments', async () => {
    const { dispatch, readService } = setup()
    const bad = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_docs', arguments: { project_id: 'nope' } },
    })
    expect(bad.body.result.isError).toBe(true)
    expect(toolText(bad.body)).toContain('Invalid arguments')
    const extra = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'read_doc',
        arguments: { project_id: P1, doc_id: D1, other: 'x' },
      },
    })
    expect(extra.body.result.isError).toBe(true)
    expect(readService.calls).toEqual([])
  })

  it('maps access errors to MCP tool errors, not JSON-RPC errors', async () => {
    const { dispatch } = setup()
    const forbidden = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_docs', arguments: { project_id: P2 } },
    })
    expect(forbidden.body.error).toBeUndefined()
    expect(forbidden.body.result.isError).toBe(true)
    expect(toolText(forbidden.body)).toContain('access denied')
    const docMissing = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'read_doc', arguments: { project_id: P1, doc_id: D2 } },
    })
    expect(docMissing.body.result.isError).toBe(true)
    expect(toolText(docMissing.body)).toContain('Document not found')
  })

  it('rejects unknown tools and unknown methods', async () => {
    const { dispatch } = setup()
    const unknownTool = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'delete_project' },
    })
    expect(unknownTool.body.result.isError).toBe(true)
    const unknownMethod = await dispatch(USER, {
      jsonrpc: '2.0',
      id: 2,
      method: 'prompts/list',
    })
    expect(unknownMethod.body.error.code).toEqual(-32601)
  })

  it('treats notifications and bad envelopes correctly', async () => {
    const { dispatch } = setup()
    expect(
      await dispatch(USER, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      })
    ).toBeNull()
    expect(
      await dispatch(USER, { jsonrpc: '2.0', method: 'some/notification' })
    ).toBeNull()
    expect(
      (await dispatch(USER, [{ jsonrpc: '2.0', method: 'ping' }])).body.error
        .code
    ).toEqual(-32600)
    expect(
      (await dispatch(USER, 'not-an-object')).body.error.code
    ).toEqual(-32600)
    expect(
      (await dispatch(USER, { id: 1, method: 'ping' })).body.error.code
    ).toEqual(-32600)
    expect(
      (await dispatch(USER, { jsonrpc: '1.0', id: 1, method: 'ping' })).body
        .error.code
    ).toEqual(-32600)
  })
})

describe('MCP middleware', () => {
  function fakeRes() {
    const res = {
      statusCode: 0,
      body: undefined,
      ended: false,
      status(code) {
        res.statusCode = code
        return res
      },
      json(body) {
        res.body = body
        return res
      },
      end() {
        res.ended = true
        return res
      },
    }
    return res
  }

  it('serves tool calls and answers notifications with 202', async () => {
    const { dispatch } = setup()
    const handle = createMcpMiddleware(dispatch)
    const res = fakeRes()
    await handle(
      {
        user_id: USER,
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects' } },
      },
      res
    )
    expect(res.statusCode).toEqual(200)
    expect(res.body.result.isError).toBe(false)

    const res2 = fakeRes()
    await handle(
      { user_id: USER, body: { jsonrpc: '2.0', method: 'notifications/initialized' } },
      res2
    )
    expect(res2.statusCode).toEqual(202)
    expect(res2.ended).toBe(true)
  })
})
