// Unit tests for the write service with every Overleaf dependency replaced by
// a fake. The tests pin down the security-critical invariants: the layer-2
// permission check (canWrite) must run immediately before each mutation and
// nothing may mutate when it refuses; docs of other projects must be
// unreachable; path traversal must be rejected before any lookup happens.
import { describe, it, expect, beforeEach } from "vitest";
import {
  createWriteService,
  MAX_UPLOAD_BYTES,
  ERROR_FORBIDDEN,
  ERROR_PROJECT_NOT_FOUND,
  ERROR_DOC_NOT_FOUND,
  ERROR_CONFLICT,
  ERROR_INVALID_PATH,
  ERROR_PAYLOAD_TOO_LARGE,
} from "../../app/src/PersonalMcpWriteService.mjs";

const USER = "507f1f77bcf86cd799439011";
const PROJECT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const DOC = "cccccccccccccccccccccccc";
const FOLDER = "eeeeeeeeeeeeeeeeeeeeeeee";
const SOURCE_FOLDER = "ffffffffffffffffffffffff";

const MUTATIONS = [
  "makeFolders",
  "addDoc",
  "replaceDocContent",
  "deleteDoc",
  "moveDoc",
  "renameDoc",
  "uploadBuffer",
];

function err(code) {
  return Object.assign(new Error(code), { code });
}

// Awaits promise, requires it to reject with err.code === code, returns err.
async function expectCode(promise, code) {
  try {
    await promise;
  } catch (e) {
    expect(e.code).toEqual(code);
    return e;
  }
  throw new Error(`expected rejection with code ${code}`);
}

function makeService(overrides = {}) {
  const calls = [];
  const audits = [];
  const deps = {
    canWrite: async () => true,
    createProject: async (userId, name) => ({ _id: PROJECT, name }),
    getProject: async () => ({ _id: PROJECT }),
    findDoc: async (project, docId) => ({
      _id: docId,
      name: "old.tex",
      folderId: SOURCE_FOLDER,
    }),
    findEntityByPath: async () => null,
    makeFolders: async () => FOLDER,
    addDoc: async () => ({ _id: DOC }),
    replaceDocContent: async () => "rev2",
    deleteDoc: async () => undefined,
    moveDoc: async () => undefined,
    renameDoc: async () => undefined,
    uploadBuffer: async () => ({ _id: DOC }),
    ...overrides,
  };
  const tracked = {};
  for (const key of Object.keys(deps)) {
    const fn = deps[key];
    tracked[key] = async (...args) => {
      calls.push([key, ...args]);
      return fn(...args);
    };
  }
  const service = createWriteService({
    ...tracked,
    audit: (info) => audits.push(info),
  });
  const names = () => calls.map((c) => c[0]);
  const argsOf = (name) => {
    const hit = calls.find((c) => c[0] === name);
    return hit ? hit.slice(1) : undefined;
  };
  const mutations = () => calls.filter((c) => MUTATIONS.includes(c[0]));
  return { service, calls, audits, names, argsOf, mutations };
}

describe("PersonalMcpWriteService", () => {
  let f;

  beforeEach(() => {
    f = makeService();
  });

  it("creates a project and audits it (no project-level canWrite exists yet)", async () => {
    const out = await f.service.createProject(USER, "Thesis");
    expect(out).toEqual({ id: PROJECT, name: "Thesis" });
    expect(f.argsOf("createProject")).toEqual([USER, "Thesis"]);
    // ownership of a brand-new project is implicit: layer 2 does not apply
    expect(f.names()).not.toContain("canWrite");
    expect(f.audits).toEqual([
      { tool: "create_project", userId: USER, projectId: PROJECT },
    ]);
  });

  it("creates a doc under created parent folders with line-split content", async () => {
    const out = await f.service.createDoc(
      USER,
      PROJECT,
      "sec/intro.tex",
      "a\nb",
    );
    expect(out).toEqual({ id: DOC, path: "sec/intro.tex" });
    expect(f.argsOf("findEntityByPath")).toEqual([PROJECT, "sec/intro.tex"]);
    expect(f.argsOf("makeFolders")).toEqual([PROJECT, "sec", USER]);
    expect(f.argsOf("addDoc")).toEqual([
      USER,
      PROJECT,
      FOLDER,
      "intro.tex",
      ["a", "b"],
    ]);
    // layer 2 must run after the lookup and before the mutation
    const order = f.names();
    expect(order.indexOf("canWrite")).toBeLessThan(order.indexOf("addDoc"));
    expect(f.audits).toEqual([
      {
        tool: "create_doc",
        userId: USER,
        projectId: PROJECT,
        docId: DOC,
        path: "sec/intro.tex",
      },
    ]);
  });

  it("creates a root doc with empty content as a single empty line", async () => {
    await f.service.createDoc(USER, PROJECT, "main.tex", undefined);
    expect(f.argsOf("makeFolders")).toEqual([PROJECT, "", USER]);
    expect(f.argsOf("addDoc")[4]).toEqual([""]);
  });

  it("conflicts on an occupied path before any permission or mutation step", async () => {
    f = makeService({ findEntityByPath: async () => ({ _id: "zz" }) });
    await expectCode(
      f.service.createDoc(USER, PROJECT, "taken.tex", "x"),
      ERROR_CONFLICT,
    );
    expect(f.names()).not.toContain("canWrite");
    expect(f.mutations()).toEqual([]);
    expect(f.audits).toEqual([]);
  });

  it("updates a doc strictly through the doc-updater dependency", async () => {
    const out = await f.service.updateDoc(USER, PROJECT, DOC, "x\ny");
    expect(out).toEqual({ version: "rev2" });
    expect(f.argsOf("replaceDocContent")).toEqual([
      USER,
      PROJECT,
      DOC,
      ["x", "y"],
    ]);
    expect(f.audits[0].tool).toEqual("update_doc");
  });

  it("reports a null version when the updater returns none", async () => {
    f = makeService({ replaceDocContent: async () => undefined });
    expect(await f.service.updateDoc(USER, PROJECT, DOC, "x")).toEqual({
      version: null,
    });
  });

  it("deletes a doc", async () => {
    const out = await f.service.deleteDoc(USER, PROJECT, DOC);
    expect(out).toEqual({ id: DOC, deleted: true });
    expect(f.argsOf("deleteDoc")).toEqual([USER, PROJECT, DOC]);
    expect(f.audits[0].tool).toEqual("delete_doc");
  });

  it("moves and renames when the file name changes", async () => {
    const out = await f.service.moveDoc(USER, PROJECT, DOC, "sub/new.tex");
    expect(out).toEqual({ id: DOC, path: "sub/new.tex" });
    expect(f.argsOf("makeFolders")).toEqual([PROJECT, "sub", USER]);
    expect(f.argsOf("moveDoc")).toEqual([USER, PROJECT, DOC, FOLDER]);
    expect(f.argsOf("renameDoc")).toEqual([USER, PROJECT, DOC, "new.tex"]);
    expect(f.audits[0].tool).toEqual("move_doc");
  });

  it("moves without renaming when only the folder changes", async () => {
    await f.service.moveDoc(USER, PROJECT, DOC, "sub/old.tex");
    expect(f.names()).toContain("moveDoc");
    expect(f.names()).not.toContain("renameDoc");
  });

  it("renames in place without moveEntity when the folder is unchanged", async () => {
    f = makeService({
      findDoc: async (project, docId) => ({
        _id: docId,
        name: "old.tex",
        folderId: FOLDER,
      }),
    });
    const out = await f.service.moveDoc(USER, PROJECT, DOC, "old2.tex");
    expect(out).toEqual({ id: DOC, path: "old2.tex" });
    // moveEntity refuses to target the folder the element is already in.
    expect(f.names()).not.toContain("moveDoc");
    expect(f.argsOf("renameDoc")).toEqual([USER, PROJECT, DOC, "old2.tex"]);
  });

  it("conflicts when another entity occupies the destination path", async () => {
    f = makeService({ findEntityByPath: async () => ({ _id: "zz" }) });
    await expectCode(
      f.service.moveDoc(USER, PROJECT, DOC, "b.tex"),
      ERROR_CONFLICT,
    );
    expect(f.mutations()).toEqual([]);
  });

  it("allows moving a doc onto the path it already lives at", async () => {
    f = makeService({
      findEntityByPath: async () => ({ _id: DOC }),
      findDoc: async (project, docId) => ({
        _id: docId,
        name: "old.tex",
        folderId: FOLDER,
      }),
    });
    await f.service.moveDoc(USER, PROJECT, DOC, "old.tex");
    // same folder, same name: neither moveEntity nor renameEntity runs
    expect(f.names()).not.toContain("moveDoc");
    expect(f.names()).not.toContain("renameDoc");
  });

  it("denies every project write when layer 2 refuses and mutates nothing", async () => {
    f = makeService({ canWrite: async () => false });
    const s = f.service;
    await expectCode(s.createDoc(USER, PROJECT, "a.tex", "x"), ERROR_FORBIDDEN);
    await expectCode(s.updateDoc(USER, PROJECT, DOC, "x"), ERROR_FORBIDDEN);
    await expectCode(s.deleteDoc(USER, PROJECT, DOC), ERROR_FORBIDDEN);
    await expectCode(s.moveDoc(USER, PROJECT, DOC, "b.tex"), ERROR_FORBIDDEN);
    await expectCode(
      s.uploadFile(USER, PROJECT, "a.png", Buffer.from("x").toString("base64")),
      ERROR_FORBIDDEN,
    );
    expect(f.mutations()).toEqual([]);
    expect(f.audits).toEqual([]);
    expect(f.names().filter((n) => n === "canWrite").length).toEqual(5);
  });

  it("never reaches a doc that belongs to another project", async () => {
    f = makeService({
      findDoc: async () => {
        throw err(ERROR_DOC_NOT_FOUND);
      },
    });
    const s = f.service;
    await expectCode(s.updateDoc(USER, PROJECT, DOC, "x"), ERROR_DOC_NOT_FOUND);
    await expectCode(s.deleteDoc(USER, PROJECT, DOC), ERROR_DOC_NOT_FOUND);
    await expectCode(
      s.moveDoc(USER, PROJECT, DOC, "b.tex"),
      ERROR_DOC_NOT_FOUND,
    );
    expect(f.mutations()).toEqual([]);
  });

  it("rejects an unknown project before any doc or permission lookup", async () => {
    f = makeService({ getProject: async () => null });
    await expectCode(
      f.service.updateDoc(USER, PROJECT, DOC, "x"),
      ERROR_PROJECT_NOT_FOUND,
    );
    expect(f.names()).not.toContain("findDoc");
    expect(f.names()).not.toContain("canWrite");
    expect(f.mutations()).toEqual([]);
  });

  it("rejects traversal and malformed paths before any lookup", async () => {
    const bad = [
      "",
      "/abs.tex",
      "a//b.tex",
      "a/./b.tex",
      "a/../b.tex",
      "a\\b.tex",
      "a\x00.tex",
      "trailing/",
      "x".repeat(1001),
    ];
    for (const path of bad) {
      f = makeService();
      await expectCode(
        f.service.createDoc(USER, PROJECT, path, "x"),
        ERROR_INVALID_PATH,
      );
      expect(f.names()).not.toContain("getProject");
      expect(f.mutations()).toEqual([]);
    }
  });

  it("rejects malformed move destinations as well", async () => {
    await expectCode(
      f.service.moveDoc(USER, PROJECT, DOC, "../escape.tex"),
      ERROR_INVALID_PATH,
    );
    expect(f.mutations()).toEqual([]);
  });

  it("uploads bytes through the import-manager dependency", async () => {
    const png = Buffer.from("fake-png-bytes");
    const out = await f.service.uploadFile(
      USER,
      PROJECT,
      "img/pic.png",
      png.toString("base64"),
    );
    expect(out).toEqual({ id: DOC, path: "img/pic.png" });
    const args = f.argsOf("uploadBuffer");
    expect(args[0]).toEqual(USER);
    expect(args[1]).toEqual(PROJECT);
    expect(args[2]).toEqual(FOLDER);
    expect(args[3]).toEqual("pic.png");
    expect(args[4].equals(png)).toBe(true);
    expect(f.audits[0]).toEqual({
      tool: "upload_file",
      userId: USER,
      projectId: PROJECT,
      docId: DOC,
      path: "img/pic.png",
    });
  });

  it("rejects uploads above the byte cap before any lookup", async () => {
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64");
    await expectCode(
      f.service.uploadFile(USER, PROJECT, "big.bin", huge),
      ERROR_PAYLOAD_TOO_LARGE,
    );
    expect(f.names()).not.toContain("getProject");
    expect(f.mutations()).toEqual([]);
  });

  it("conflicts on upload onto an occupied path", async () => {
    f = makeService({ findEntityByPath: async () => ({ _id: "zz" }) });
    await expectCode(
      f.service.uploadFile(
        USER,
        PROJECT,
        "a.png",
        Buffer.from("x").toString("base64"),
      ),
      ERROR_CONFLICT,
    );
    expect(f.mutations()).toEqual([]);
  });
});
