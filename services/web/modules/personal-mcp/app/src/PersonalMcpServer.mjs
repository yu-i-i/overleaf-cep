// Minimal Model Context Protocol server: Streamable HTTP JSON-RPC 2.0 with
// zero additional dependencies (JSON responses only, no SSE streams, no
// server-initiated messages, stateless). The userId always comes from the
// authenticated bearer token passed in by the transport layer, never from
// request params. The write-scope flag likewise comes only from the scope
// stored on the authenticated token (req.user_scope), never from the MCP
// message: a message-injected scope/user_id field is simply ignored. Tool
// arguments and document contents are never logged.
import { z } from "zod";
import logger from "@overleaf/logger";
import Metrics from "@overleaf/metrics";
import { PERSONAL_MCP_WRITE_SCOPE } from "./PersonalMcpTokenManager.mjs";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = {
  name: "overleaf-personal-mcp",
  title: "Overleaf Personal MCP",
  version: "1.1.0",
};

const OBJECT_ID = z.string().regex(/^[a-f0-9]{24}$/i);
// Paths are project-relative ('main.tex', 'figures/pic.png'). Structural
// validation (no '..', empty segments, control characters) happens in the
// write service so it can be unit tested without the Overleaf internals.
const PATH_STR = z.string().min(1).max(1000);
const MAX_DOC_CONTENT_CHARS = 5_000_000;
// 28M base64 chars ≈ 21MB decoded; the write service enforces the decoded cap.
const MAX_BASE64_CHARS = 28_000_000;

const READ_TOOLS = [
  {
    name: "list_projects",
    description:
      "List every Overleaf project the token owner can read (owned, shared read/write, read-only, or review), with role information.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_docs",
    description:
      "List the documents (id and path) of a project the token owner can read.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "24-character hex project id.",
        },
      },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
  {
    name: "read_doc",
    description:
      "Read the full text content of a document. The document must belong to the given project, and the token owner must have read access to it.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "24-character hex project id.",
        },
        doc_id: {
          type: "string",
          description: "24-character hex document id.",
        },
      },
      required: ["project_id", "doc_id"],
      additionalProperties: false,
    },
  },
];

// Only advertised by tools/list and only callable for read-write tokens.
const WRITE_TOOLS = [
  {
    name: "create_project",
    description:
      "Create a new empty project owned by the token owner. Returns { id, name }.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name (cannot contain / or \\ characters).",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "create_doc",
    description:
      "Create a new text document at path within a project, creating missing parent folders first. Fails if the path already exists. content is the optional initial text. Returns { id, path }.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "24-character hex project id.",
        },
        path: {
          type: "string",
          description:
            'Project-relative document path, e.g. "main.tex" or "sub/chapter1.tex".',
        },
        content: {
          type: "string",
          description: "Optional initial document content.",
        },
      },
      required: ["project_id", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "update_doc",
    description:
      "Replace the entire content of an existing document. The write goes through the real-time doc-updater, so open editors of the document are notified live instead of seeing a stale copy. Returns { version }.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "24-character hex project id.",
        },
        doc_id: {
          type: "string",
          description: "24-character hex document id.",
        },
        content: {
          type: "string",
          description: "The complete new content of the document.",
        },
      },
      required: ["project_id", "doc_id", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_doc",
    description:
      "Delete an existing document from a project. Only documents can be deleted (not folders or assets). Returns { id, deleted }.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "24-character hex project id.",
        },
        doc_id: {
          type: "string",
          description: "24-character hex document id.",
        },
      },
      required: ["project_id", "doc_id"],
      additionalProperties: false,
    },
  },
  {
    name: "move_doc",
    description:
      "Move and/or rename an existing document to new_path within the project, creating missing parent folders. Fails if the destination path is taken by another entity. Returns { id, path }.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "24-character hex project id.",
        },
        doc_id: {
          type: "string",
          description: "24-character hex document id.",
        },
        new_path: {
          type: "string",
          description:
            'New project-relative path, e.g. "chapters/intro.tex". Can rename by changing only the file name.',
        },
      },
      required: ["project_id", "doc_id", "new_path"],
      additionalProperties: false,
    },
  },
  {
    name: "upload_file",
    description:
      "Upload a file (figure, BibTeX, …) given as base64 to path within the project, creating missing parent folders. Like the web upload, text-like extensions are imported as documents, binary extensions as files. Fails if the path already exists. Returns { id, path }.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "24-character hex project id.",
        },
        path: {
          type: "string",
          description: 'Project-relative file path, e.g. "figures/logo.png".',
        },
        content_base64: {
          type: "string",
          description: "File bytes encoded as base64.",
        },
      },
      required: ["project_id", "path", "content_base64"],
      additionalProperties: false,
    },
  },
];

const TOOLS = READ_TOOLS;
const TOOL_NAMES = READ_TOOLS.concat(WRITE_TOOLS).map((tool) => tool.name);

const TOOL_ARG_SCHEMAS = {
  list_projects: z.object({}).strict(),
  list_docs: z.object({ project_id: OBJECT_ID }).strict(),
  read_doc: z.object({ project_id: OBJECT_ID, doc_id: OBJECT_ID }).strict(),
  create_project: z
    .object({ name: z.string().trim().min(1).max(300) })
    .strict(),
  create_doc: z
    .object({
      project_id: OBJECT_ID,
      path: PATH_STR,
      content: z.string().max(MAX_DOC_CONTENT_CHARS).optional(),
    })
    .strict(),
  update_doc: z
    .object({
      project_id: OBJECT_ID,
      doc_id: OBJECT_ID,
      content: z.string().max(MAX_DOC_CONTENT_CHARS),
    })
    .strict(),
  delete_doc: z.object({ project_id: OBJECT_ID, doc_id: OBJECT_ID }).strict(),
  move_doc: z
    .object({
      project_id: OBJECT_ID,
      doc_id: OBJECT_ID,
      new_path: PATH_STR,
    })
    .strict(),
  upload_file: z
    .object({
      project_id: OBJECT_ID,
      path: PATH_STR,
      content_base64: z.string().min(1).max(MAX_BASE64_CHARS),
    })
    .strict(),
};

const WRITE_TOOL_NAMES = WRITE_TOOLS.map((tool) => tool.name);

function _result(id, result) {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function _rpcError(id, code, message) {
  return {
    status: 200,
    body: { jsonrpc: "2.0", id, error: { code, message } },
  };
}

// Tool execution failures are reported as isError results per the MCP spec,
// so the model can see the reason without breaking the protocol layer.
function _toolError(id, message) {
  return _result(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

function _toolLabel(name) {
  return TOOL_NAMES.includes(name) ? name : "other";
}

function _scopeDenied() {
  const err = new Error("read-write scope required");
  err.code = "SCOPE_DENIED";
  throw err;
}

export function createDispatcher({ readService, writeService }) {
  async function callTool(userId, name, args, canWrite) {
    // Scope gate first: before any argument parsing or service call, so a
    // non-rw token cannot even probe write-tool argument validation.
    if (canWrite === false && WRITE_TOOL_NAMES.includes(name)) _scopeDenied();
    if (name === "list_projects") {
      TOOL_ARG_SCHEMAS.list_projects.parse(args ?? {});
      return { projects: await readService.listProjects(userId) };
    }
    if (name === "list_docs") {
      const { project_id } = TOOL_ARG_SCHEMAS.list_docs.parse(args ?? {});
      return { documents: await readService.listDocs(userId, project_id) };
    }
    if (name === "read_doc") {
      const { project_id, doc_id } = TOOL_ARG_SCHEMAS.read_doc.parse(
        args ?? {},
      );
      const doc = await readService.readDoc(userId, project_id, doc_id);
      return { document_id: doc_id, ...doc };
    }
    if (name === "create_project") {
      const { name: projectName } = TOOL_ARG_SCHEMAS.create_project.parse(
        args ?? {},
      );
      return await writeService.createProject(userId, projectName);
    }
    if (name === "create_doc") {
      const { project_id, path, content } = TOOL_ARG_SCHEMAS.create_doc.parse(
        args ?? {},
      );
      return await writeService.createDoc(userId, project_id, path, content);
    }
    if (name === "update_doc") {
      const { project_id, doc_id, content } = TOOL_ARG_SCHEMAS.update_doc.parse(
        args ?? {},
      );
      return await writeService.updateDoc(userId, project_id, doc_id, content);
    }
    if (name === "delete_doc") {
      const { project_id, doc_id } = TOOL_ARG_SCHEMAS.delete_doc.parse(
        args ?? {},
      );
      return await writeService.deleteDoc(userId, project_id, doc_id);
    }
    if (name === "move_doc") {
      const { project_id, doc_id, new_path } = TOOL_ARG_SCHEMAS.move_doc.parse(
        args ?? {},
      );
      return await writeService.moveDoc(userId, project_id, doc_id, new_path);
    }
    if (name === "upload_file") {
      const { project_id, path, content_base64 } =
        TOOL_ARG_SCHEMAS.upload_file.parse(args ?? {});
      return await writeService.uploadFile(
        userId,
        project_id,
        path,
        content_base64,
      );
    }
    return undefined;
  }

  // Returns { status, body }, or null for notifications (the transport then
  // answers 202 Accepted with no body). The scope must be the value stored on
  // the authenticated token; anything else (undefined, 'read', garbage)
  // behaves exactly like the legacy read-only token.
  return async function dispatch(userId, message, scope) {
    const canWrite = scope === PERSONAL_MCP_WRITE_SCOPE && writeService != null;

    if (
      message == null ||
      typeof message !== "object" ||
      Array.isArray(message)
    ) {
      return _rpcError(null, -32600, "Invalid Request");
    }
    const { method, params } = message;
    const id = message.id ?? null;
    const isNotification = message.id == null;
    if (message.jsonrpc !== "2.0" || typeof method !== "string") {
      // JSON-RPC 2.0 requires jsonrpc:"2.0" and a string method.
      return _rpcError(id, -32600, "Invalid Request");
    }

    switch (method) {
      case "initialize": {
        const requested = params?.protocolVersion;
        const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return _result(id, {
          protocolVersion: negotiated,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: canWrite
            ? "Read/write access to the Overleaf projects your account can " +
              "access. Write tools create, edit, move, delete or upload " +
              "content in projects you can edit. There is no compile tool."
            : "Read-only access to the Overleaf projects your account can " +
              "read. There are no write, delete, upload or compile tools. " +
              "A read-write token can unlock the write tools.",
        });
      }

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return _result(id, {});

      case "tools/list":
        // Write tools are invisible to read-only tokens, not merely denied.
        return _result(id, {
          tools: canWrite ? READ_TOOLS.concat(WRITE_TOOLS) : READ_TOOLS,
        });

      case "tools/call": {
        const name = typeof params?.name === "string" ? params.name : "";
        let out;
        try {
          out = await callTool(userId, name, params?.arguments, canWrite);
        } catch (err) {
          Metrics.inc("mcp.tools.call", 1, {
            tool: _toolLabel(name),
            status: "error",
          });
          if (err instanceof z.ZodError) {
            return _toolError(id, "Invalid arguments for this tool.");
          }
          if (err?.code === "SCOPE_DENIED") {
            return _toolError(id, "This tool requires a read-write token.");
          }
          const code = err?.code;
          if (code === "FORBIDDEN" || code === "PROJECT_NOT_FOUND") {
            return _toolError(id, "Project not found or access denied.");
          }
          if (code === "DOC_NOT_FOUND") {
            return _toolError(id, "Document not found in this project.");
          }
          if (code === "CONFLICT") {
            return _toolError(id, "An entity with that path already exists.");
          }
          if (code === "INVALID_PATH") {
            return _toolError(id, "Invalid path.");
          }
          if (code === "PAYLOAD_TOO_LARGE") {
            return _toolError(id, "Uploaded content is too large.");
          }
          // Never log arguments or document content, only the shape of the failure.
          logger.error(
            { err, userId, tool: _toolLabel(name) },
            "personal-mcp: tool call failed",
          );
          return _toolError(id, "Tool call failed.");
        }
        if (out === undefined) {
          return _toolError(id, `Unknown tool: ${name}`);
        }
        Metrics.inc("mcp.tools.call", 1, {
          tool: _toolLabel(name),
          status: "ok",
        });
        logger.info(
          { userId, tool: _toolLabel(name) },
          "personal-mcp: tool call ok",
        );
        return _result(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          isError: false,
        });
      }

      default:
        if (isNotification) return null;
        return _rpcError(id, -32601, "Method not found");
    }
  };
}

export function createMcpMiddleware(dispatch) {
  return async function handleMcp(req, res) {
    // The transport only ever passes the token-derived user id and scope down.
    const userId = req.user_id;
    let outcome;
    try {
      outcome = await dispatch(userId, req.body, req.user_scope);
    } catch (err) {
      logger.error({ err, userId }, "personal-mcp: request handling failed");
      return res.status(500).json({ error: "internal_error" });
    }
    if (outcome == null) return res.status(202).end();
    return res.status(outcome.status).json(outcome.body);
  };
}
