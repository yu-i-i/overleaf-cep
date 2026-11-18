// Minimal Model Context Protocol server: Streamable HTTP JSON-RPC 2.0 with
// zero additional dependencies (JSON responses only, no SSE streams, no
// server-initiated messages, stateless). The userId always comes from the
// authenticated bearer token passed in by the transport layer, never from
// request params. Tool arguments and document contents are never logged.
import { z } from 'zod'
import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = {
  name: 'overleaf-personal-mcp',
  title: 'Overleaf Personal MCP (read-only)',
  version: '1.0.0',
}

const OBJECT_ID = z.string().regex(/^[a-f0-9]{24}$/i)

const TOOL_NAMES = ['list_projects', 'list_docs', 'read_doc']

const TOOLS = [
  {
    name: 'list_projects',
    description:
      'List every Overleaf project the token owner can read (owned, shared read/write, read-only, or review), with role information.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_docs',
    description:
      'List the documents (id and path) of a project the token owner can read.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: '24-character hex project id.',
        },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_doc',
    description:
      'Read the full text content of a document. The document must belong to the given project, and the token owner must have read access to it.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: '24-character hex project id.',
        },
        doc_id: {
          type: 'string',
          description: '24-character hex document id.',
        },
      },
      required: ['project_id', 'doc_id'],
      additionalProperties: false,
    },
  },
]

const TOOL_ARG_SCHEMAS = {
  list_projects: z.object({}).strict(),
  list_docs: z.object({ project_id: OBJECT_ID }).strict(),
  read_doc: z.object({ project_id: OBJECT_ID, doc_id: OBJECT_ID }).strict(),
}

function _result(id, result) {
  return { status: 200, body: { jsonrpc: '2.0', id, result } }
}

function _rpcError(id, code, message) {
  return {
    status: 200,
    body: { jsonrpc: '2.0', id, error: { code, message } },
  }
}

// Tool execution failures are reported as isError results per the MCP spec,
// so the model can see the reason without breaking the protocol layer.
function _toolError(id, message) {
  return _result(id, {
    content: [{ type: 'text', text: message }],
    isError: true,
  })
}

function _toolLabel(name) {
  return TOOL_NAMES.includes(name) ? name : 'other'
}

export function createDispatcher({ readService }) {
  async function callTool(userId, name, args) {
    if (name === 'list_projects') {
      TOOL_ARG_SCHEMAS.list_projects.parse(args ?? {})
      return { projects: await readService.listProjects(userId) }
    }
    if (name === 'list_docs') {
      const { project_id } = TOOL_ARG_SCHEMAS.list_docs.parse(args ?? {})
      return { documents: await readService.listDocs(userId, project_id) }
    }
    if (name === 'read_doc') {
      const { project_id, doc_id } = TOOL_ARG_SCHEMAS.read_doc.parse(
        args ?? {}
      )
      const doc = await readService.readDoc(userId, project_id, doc_id)
      return { document_id: doc_id, ...doc }
    }
    return undefined
  }

  // Returns { status, body }, or null for notifications (the transport then
  // answers 202 Accepted with no body).
  return async function dispatch(userId, message) {
    if (
      message == null ||
      typeof message !== 'object' ||
      Array.isArray(message)
    ) {
      return _rpcError(null, -32600, 'Invalid Request')
    }
    const { method, params } = message
    const id = message.id ?? null
    const isNotification = message.id == null
    if (message.jsonrpc !== '2.0' || typeof method !== 'string') {
      // JSON-RPC 2.0 requires jsonrpc:"2.0" and a string method.
      return _rpcError(id, -32600, 'Invalid Request')
    }

    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion
        const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0]
        return _result(id, {
          protocolVersion: negotiated,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'Read-only access to the Overleaf projects your account can read. ' +
            'There are no write, delete, upload or compile tools.',
        })
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null

      case 'ping':
        return _result(id, {})

      case 'tools/list':
        return _result(id, { tools: TOOLS })

      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : ''
        let out
        try {
          out = await callTool(userId, name, params?.arguments)
        } catch (err) {
          Metrics.inc('mcp.tools.call', 1, {
            tool: _toolLabel(name),
            status: 'error',
          })
          if (err instanceof z.ZodError) {
            return _toolError(id, 'Invalid arguments for this tool.')
          }
          const code = err?.code
          if (code === 'FORBIDDEN' || code === 'PROJECT_NOT_FOUND') {
            return _toolError(id, 'Project not found or access denied.')
          }
          if (code === 'DOC_NOT_FOUND') {
            return _toolError(id, 'Document not found in this project.')
          }
          // Never log arguments or document content, only the shape of the failure.
          logger.error(
            { err, userId, tool: _toolLabel(name) },
            'personal-mcp: tool call failed'
          )
          return _toolError(id, 'Tool call failed.')
        }
        if (out === undefined) {
          return _toolError(id, `Unknown tool: ${name}`)
        }
        Metrics.inc('mcp.tools.call', 1, {
          tool: _toolLabel(name),
          status: 'ok',
        })
        logger.info(
          { userId, tool: _toolLabel(name) },
          'personal-mcp: tool call ok'
        )
        return _result(id, {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          isError: false,
        })
      }

      default:
        if (isNotification) return null
        return _rpcError(id, -32601, 'Method not found')
    }
  }
}

export function createMcpMiddleware(dispatch) {
  return async function handleMcp(req, res) {
    // The transport only ever passes the token-derived user id down.
    const userId = req.user_id
    let outcome
    try {
      outcome = await dispatch(userId, req.body)
    } catch (err) {
      logger.error({ err, userId }, 'personal-mcp: request handling failed')
      return res.status(500).json({ error: 'internal_error' })
    }
    if (outcome == null) return res.status(202).end()
    return res.status(outcome.status).json(outcome.body)
  }
}
