import { describe, it, expect } from "vitest";
import {
  createDispatcher,
  createMcpMiddleware,
} from "../../app/src/PersonalMcpServer.mjs";

const USER = "507f1f77bcf86cd799439011";
const P1 = "aaaaaaaaaaaaaaaaaaaaaaaa";
const P2 = "bbbbbbbbbbbbbbbbbbbbbbbb";
const D1 = "cccccccccccccccccccccccc";
const D2 = "dddddddddddddddddddddddd";

function fakeReadService() {
  const calls = [];
  return {
    calls,
    async listProjects(userId) {
      calls.push(["list_projects", userId]);
      return [{ id: P1, name: "Mine", role: "owned" }];
    },
    async listDocs(userId, projectId) {
      calls.push(["list_docs", userId, projectId]);
      if (projectId === P2) {
        throw Object.assign(new Error("denied"), { code: "FORBIDDEN" });
      }
      return [{ id: D1, path: "/main.tex" }];
    },
    async readDoc(userId, projectId, docId) {
      calls.push(["read_doc", userId, projectId, docId]);
      if (projectId === P2) {
        throw Object.assign(new Error("denied"), { code: "FORBIDDEN" });
      }
      if (docId === D2) {
        throw Object.assign(new Error("nope"), { code: "DOC_NOT_FOUND" });
      }
      return { text: "hello", version: "rev1" };
    },
  };
}

function setup() {
  const readService = fakeReadService();
  const dispatch = createDispatcher({ readService });
  return { readService, dispatch };
}

function toolText(body) {
  return body.result.content[0].text;
}

describe("MCP dispatcher", () => {
  it("initializes with a supported protocol version", async () => {
    const { dispatch } = setup();
    const out = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} },
    });
    expect(out.status).toEqual(200);
    expect(out.body.result.protocolVersion).toEqual("2024-11-05");
    expect(out.body.result.capabilities.tools).toBeDefined();
    expect(out.body.result.serverInfo.name).toEqual("overleaf-personal-mcp");
    const fallback = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "9999-99-99" },
    });
    expect(fallback.body.result.protocolVersion).toEqual("2025-06-18");
  });

  it("answers ping and tools/list", async () => {
    const { dispatch } = setup();
    const ping = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    expect(ping.body.result).toEqual({});
    const list = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(list.body.result.tools.map((t) => t.name)).toEqual([
      "list_projects",
      "list_docs",
      "read_doc",
    ]);
    for (const tool of list.body.result.tools) {
      expect(tool.inputSchema.type).toEqual("object");
    }
  });

  it("passes the token-derived userId to the read service, never body data", async () => {
    const { dispatch, readService } = setup();
    const out = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_projects", user_id: "evil-injected-id" },
    });
    expect(out.body.result.isError).toBe(false);
    expect(JSON.parse(toolText(out.body)).projects).toEqual([
      { id: P1, name: "Mine", role: "owned" },
    ]);
    expect(readService.calls).toEqual([["list_projects", USER]]);
  });

  it("validates tool arguments", async () => {
    const { dispatch, readService } = setup();
    const bad = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_docs", arguments: { project_id: "nope" } },
    });
    expect(bad.body.result.isError).toBe(true);
    expect(toolText(bad.body)).toContain("Invalid arguments");
    const extra = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "read_doc",
        arguments: { project_id: P1, doc_id: D1, other: "x" },
      },
    });
    expect(extra.body.result.isError).toBe(true);
    expect(readService.calls).toEqual([]);
  });

  it("maps access errors to MCP tool errors, not JSON-RPC errors", async () => {
    const { dispatch } = setup();
    const forbidden = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_docs", arguments: { project_id: P2 } },
    });
    expect(forbidden.body.error).toBeUndefined();
    expect(forbidden.body.result.isError).toBe(true);
    expect(toolText(forbidden.body)).toContain("access denied");
    const docMissing = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "read_doc", arguments: { project_id: P1, doc_id: D2 } },
    });
    expect(docMissing.body.result.isError).toBe(true);
    expect(toolText(docMissing.body)).toContain("Document not found");
  });

  it("rejects unknown tools and unknown methods", async () => {
    const { dispatch } = setup();
    const unknownTool = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "delete_project" },
    });
    expect(unknownTool.body.result.isError).toBe(true);
    const unknownMethod = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/list",
    });
    expect(unknownMethod.body.error.code).toEqual(-32601);
  });

  it("treats notifications and bad envelopes correctly", async () => {
    const { dispatch } = setup();
    expect(
      await dispatch(USER, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    ).toBeNull();
    expect(
      await dispatch(USER, { jsonrpc: "2.0", method: "some/notification" }),
    ).toBeNull();
    expect(
      (await dispatch(USER, [{ jsonrpc: "2.0", method: "ping" }])).body.error
        .code,
    ).toEqual(-32600);
    expect((await dispatch(USER, "not-an-object")).body.error.code).toEqual(
      -32600,
    );
    expect(
      (await dispatch(USER, { id: 1, method: "ping" })).body.error.code,
    ).toEqual(-32600);
    expect(
      (await dispatch(USER, { jsonrpc: "1.0", id: 1, method: "ping" })).body
        .error.code,
    ).toEqual(-32600);
  });
});

describe("write tools and scope gating", () => {
  const RW = "personal_mcp_read_write";

  function fakeWriteService() {
    const calls = [];
    const errs = {};
    return {
      calls,
      errs,
      async createProject(userId, name) {
        calls.push(["create_project", userId, name]);
        if (errs.createProject) throw errs.createProject;
        return { id: P2, name };
      },
      async createDoc(userId, projectId, path, content) {
        calls.push(["create_doc", userId, projectId, path, content]);
        if (errs.createDoc) throw errs.createDoc;
        return { id: D1, path };
      },
      async updateDoc(userId, projectId, docId, content) {
        calls.push(["update_doc", userId, projectId, docId, content]);
        if (errs.updateDoc) throw errs.updateDoc;
        return { version: "rev9" };
      },
      async deleteDoc(userId, projectId, docId) {
        calls.push(["delete_doc", userId, projectId, docId]);
        if (errs.deleteDoc) throw errs.deleteDoc;
        return { id: docId, deleted: true };
      },
      async moveDoc(userId, projectId, docId, newPath) {
        calls.push(["move_doc", userId, projectId, docId, newPath]);
        if (errs.moveDoc) throw errs.moveDoc;
        return { id: docId, path: newPath };
      },
      async uploadFile(userId, projectId, path, contentBase64) {
        calls.push(["upload_file", userId, projectId, path, contentBase64]);
        if (errs.uploadFile) throw errs.uploadFile;
        return { id: D1, path };
      },
    };
  }

  function setupWrite() {
    const readService = fakeReadService();
    const writeService = fakeWriteService();
    const dispatch = createDispatcher({ readService, writeService });
    return { readService, writeService, dispatch };
  }

  const call = (name, args) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });

  it("advertises write tools only for read-write scope", async () => {
    const { dispatch } = setupWrite();
    const readList = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(readList.body.result.tools.length).toEqual(3);
    const rwList = await dispatch(
      USER,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      RW,
    );
    expect(rwList.body.result.tools.map((t) => t.name)).toEqual([
      "list_projects",
      "list_docs",
      "read_doc",
      "create_project",
      "create_doc",
      "update_doc",
      "delete_doc",
      "move_doc",
      "upload_file",
    ]);
    // A dispatcher without a write service can never write, not even with
    // read-write scope.
    const { dispatch: noWrite } = setup();
    const hidden = await noWrite(
      USER,
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      RW,
    );
    expect(hidden.body.result.tools.length).toEqual(3);
  });

  it("denies write tools for read tokens and never touches the write service", async () => {
    const { dispatch, writeService } = setupWrite();
    const out = await dispatch(
      USER,
      call("update_doc", { project_id: P1, doc_id: D1, content: "x" }),
    );
    expect(out.body.result.isError).toBe(true);
    expect(toolText(out.body)).toContain("read-write token");
    expect(writeService.calls).toEqual([]);
  });

  it("ignores scope and user_id injected into the message body", async () => {
    const { dispatch, writeService } = setupWrite();
    const out = await dispatch(USER, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      scope: RW,
      user_id: "evil-injected-id",
      params: {
        name: "create_doc",
        scope: RW,
        user_id: "evil-injected-id",
        arguments: { project_id: P1, path: "a.tex", scope: RW },
      },
    });
    // scope comes only from the token-authenticated dispatch argument, which
    // is absent here: the request behaves as plain read-only.
    expect(out.body.result.isError).toBe(true);
    expect(toolText(out.body)).toContain("read-write token");
    expect(writeService.calls).toEqual([]);
  });

  it("runs write tools with the token userId for rw scope", async () => {
    const { dispatch, writeService } = setupWrite();
    const created = await dispatch(
      USER,
      call("create_project", { name: "Thesis" }),
      RW,
    );
    expect(created.body.result.isError).toBe(false);
    expect(JSON.parse(toolText(created.body))).toEqual({
      id: P2,
      name: "Thesis",
    });
    const updated = await dispatch(
      USER,
      call("update_doc", { project_id: P1, doc_id: D1, content: "new\nlines" }),
      RW,
    );
    expect(JSON.parse(toolText(updated.body))).toEqual({ version: "rev9" });
    expect(writeService.calls).toEqual([
      ["create_project", USER, "Thesis"],
      ["update_doc", USER, P1, D1, "new\nlines"],
    ]);
  });

  it("validates write tool arguments strictly and maps write errors", async () => {
    const { dispatch, writeService } = setupWrite();
    const badId = await dispatch(
      USER,
      call("create_doc", { project_id: "nope", path: "a.tex" }),
      RW,
    );
    expect(badId.body.result.isError).toBe(true);
    expect(toolText(badId.body)).toContain("Invalid arguments");
    const extraArg = await dispatch(
      USER,
      call("update_doc", {
        project_id: P1,
        doc_id: D1,
        content: "c",
        force: true,
      }),
      RW,
    );
    expect(extraArg.body.result.isError).toBe(true);
    expect(writeService.calls).toEqual([]);

    writeService.errs.moveDoc = Object.assign(new Error("taken"), {
      code: "CONFLICT",
    });
    const conflict = await dispatch(
      USER,
      call("move_doc", { project_id: P1, doc_id: D1, new_path: "b.tex" }),
      RW,
    );
    expect(toolText(conflict.body)).toContain("already exists");

    writeService.errs.deleteDoc = Object.assign(new Error("bad path"), {
      code: "INVALID_PATH",
    });
    const badPath = await dispatch(
      USER,
      call("delete_doc", { project_id: P1, doc_id: D1 }),
      RW,
    );
    expect(toolText(badPath.body)).toContain("Invalid path");
  });
});

describe("MCP middleware", () => {
  function fakeRes() {
    const res = {
      statusCode: 0,
      body: undefined,
      ended: false,
      status(code) {
        res.statusCode = code;
        return res;
      },
      json(body) {
        res.body = body;
        return res;
      },
      end() {
        res.ended = true;
        return res;
      },
    };
    return res;
  }

  it("serves tool calls and answers notifications with 202", async () => {
    const { dispatch } = setup();
    const handle = createMcpMiddleware(dispatch);
    const res = fakeRes();
    await handle(
      {
        user_id: USER,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_projects" },
        },
      },
      res,
    );
    expect(res.statusCode).toEqual(200);
    expect(res.body.result.isError).toBe(false);

    const res2 = fakeRes();
    await handle(
      {
        user_id: USER,
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      },
      res2,
    );
    expect(res2.statusCode).toEqual(202);
    expect(res2.ended).toBe(true);
  });

  it("passes only req.user_scope (never body fields) to the dispatcher", async () => {
    const seen = [];
    const spy = async (userId, message, scope) => {
      seen.push([userId, message?.params?.name, scope]);
      return {
        status: 200,
        body: { jsonrpc: "2.0", id: message.id ?? null, result: {} },
      };
    };
    const handle = createMcpMiddleware(spy);
    const res = fakeRes();
    await handle(
      {
        user_id: USER,
        user_scope: "personal_mcp_read_write",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "update_doc", user_scope: "evil", scope: "evil" },
        },
      },
      res,
    );
    expect(seen).toEqual([[USER, "update_doc", "personal_mcp_read_write"]]);
  });
});
