// The caller supplies the authenticated user ID and the write-capable scope
// flag has already been enforced by the MCP dispatcher (PersonalMcpServer);
// this service itself stays scope-agnostic and testable without any Overleaf
// internals — every external call is injected. Even so, the write permission
// (canWrite) is re-checked here, immediately before each mutation: this is
// the second of the two authorization layers and it protects every caller of
// the service, not just the MCP path.
import {
  ERROR_FORBIDDEN,
  ERROR_PROJECT_NOT_FOUND,
  ERROR_DOC_NOT_FOUND,
  errorWithCode,
} from "./PersonalMcpReadService.mjs";

export { ERROR_FORBIDDEN, ERROR_PROJECT_NOT_FOUND, ERROR_DOC_NOT_FOUND };

export const ERROR_CONFLICT = "CONFLICT";
export const ERROR_INVALID_PATH = "INVALID_PATH";
export const ERROR_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

// Decoded upload size cap. The JSON argument schema caps the base64 text
// separately (see PersonalMcpServer); this is the cap on the actual bytes.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const MAX_PATH_LENGTH = 1000;

// Project-relative paths only. Structural rules are validated here (not in
// zod) so they can be unit tested without the protocol layer:
// no leading/trailing/double slash, no '.' or '..', no backslash, no control
// characters. 'a/../b' style traversal can never reach another project.
function validatePath(projectPath) {
  if (
    typeof projectPath !== "string" ||
    projectPath.length === 0 ||
    projectPath.length > MAX_PATH_LENGTH ||
    projectPath.includes("\\")
  ) {
    throw errorWithCode("Invalid path", ERROR_INVALID_PATH);
  }
  const segments = projectPath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw errorWithCode("Invalid path", ERROR_INVALID_PATH);
    }
    if (/[\x00-\x1f\x7f]/.test(segment)) {
      throw errorWithCode("Invalid path", ERROR_INVALID_PATH);
    }
  }
  return {
    name: segments[segments.length - 1],
    folderPath: segments.slice(0, -1).join("/"),
  };
}

function idOf(entity) {
  if (entity == null) return null;
  if (entity._id != null) return String(entity._id);
  if (entity.id != null) return String(entity.id);
  return null;
}

export function createWriteService({
  createProject,
  canWrite,
  getProject,
  findDoc,
  findEntityByPath,
  makeFolders,
  addDoc,
  replaceDocContent,
  deleteDoc,
  moveDoc,
  renameDoc,
  uploadBuffer,
  audit = () => {},
}) {
  async function requireProject(projectId) {
    const project = await getProject(projectId);
    if (!project) {
      throw errorWithCode("Project not found", ERROR_PROJECT_NOT_FOUND);
    }
    return project;
  }

  // Layer 2 of the double authorization: run immediately before every
  // mutation (never once per session). Passing a null token means link-token
  // (tokenReadOnly/tokenReadAndWrite) members can never match here, matching
  // the read service's exclusion of link-token projects.
  async function requireWrite(userId, projectId) {
    if (!(await canWrite(userId, projectId))) {
      throw errorWithCode("Project content access denied", ERROR_FORBIDDEN);
    }
  }

  // Audit every successful write: ids, tool and path only, never content.
  function record(info) {
    audit(info);
  }

  return {
    async createProject(userId, projectName) {
      const project = await createProject(userId, projectName);
      record({
        tool: "create_project",
        userId,
        projectId: idOf(project),
      });
      return { id: idOf(project), name: projectName };
    },

    async createDoc(userId, projectId, projectPath, content) {
      const { name, folderPath } = validatePath(projectPath);
      // Layer 1: the project must be visible (null project -> not found),
      // and the path must be free. Only then, right before mutating, layer 2.
      await requireProject(projectId);
      const existing = await findEntityByPath(projectId, projectPath);
      if (existing != null) {
        throw errorWithCode("Path already exists", ERROR_CONFLICT);
      }
      await requireWrite(userId, projectId);
      const folderId = await makeFolders(projectId, folderPath, userId);
      const lines = String(content == null ? "" : content).split("\n");
      const doc = await addDoc(userId, projectId, folderId, name, lines);
      const docId = idOf(doc);
      record({
        tool: "create_doc",
        userId,
        projectId,
        docId,
        path: projectPath,
      });
      return { id: docId, path: projectPath };
    },

    async updateDoc(userId, projectId, docId, content) {
      const project = await requireProject(projectId);
      // The doc must belong to the requested project: a valid doc id of
      // another project must not be writable by naming that other project.
      await findDoc(project, docId);
      await requireWrite(userId, projectId);
      const lines = String(content).split("\n");
      // Goes through doc-updater so every open editor is notified live and
      // the change lands in history; never a raw database overwrite.
      const version = await replaceDocContent(userId, projectId, docId, lines);
      record({ tool: "update_doc", userId, projectId, docId });
      return { version: version ?? null };
    },

    async deleteDoc(userId, projectId, docId) {
      const project = await requireProject(projectId);
      await findDoc(project, docId);
      await requireWrite(userId, projectId);
      await deleteDoc(userId, projectId, docId);
      record({ tool: "delete_doc", userId, projectId, docId });
      return { id: docId, deleted: true };
    },

    async moveDoc(userId, projectId, docId, newPath) {
      const { name, folderPath } = validatePath(newPath);
      const project = await requireProject(projectId);
      const doc = await findDoc(project, docId);
      const destination = await findEntityByPath(projectId, newPath);
      const destinationId = idOf(destination);
      // Moving onto oneself is a no-op (same doc at the same path); any other
      // occupant of the destination path is a conflict.
      if (destinationId != null && destinationId !== String(docId)) {
        throw errorWithCode("Destination path already exists", ERROR_CONFLICT);
      }
      await requireWrite(userId, projectId);
      const folderId = await makeFolders(projectId, folderPath, userId);
      // moveEntity refuses to target the folder an element is already in, so a
      // same-folder move (a pure rename) skips it and only runs renameEntity
      // below, mirroring the separate web-UI rename route.
      const sameFolder =
        doc?.folderId != null && String(doc.folderId) === String(folderId);
      if (!sameFolder) {
        await moveDoc(userId, projectId, docId, folderId);
      }
      // A rename is a separate entity operation, mirroring the web UI.
      const currentName = doc != null ? doc.name : undefined;
      if (currentName != null && currentName !== name) {
        await renameDoc(userId, projectId, docId, name);
      }
      record({ tool: "move_doc", userId, projectId, docId, path: newPath });
      return { id: String(docId), path: newPath };
    },

    async uploadFile(userId, projectId, projectPath, contentBase64) {
      const { name, folderPath } = validatePath(projectPath);
      const buffer = Buffer.from(String(contentBase64), "base64");
      if (buffer.length > MAX_UPLOAD_BYTES) {
        throw errorWithCode(
          "Uploaded content is too large",
          ERROR_PAYLOAD_TOO_LARGE,
        );
      }
      await requireProject(projectId);
      const existing = await findEntityByPath(projectId, projectPath);
      if (existing != null) {
        throw errorWithCode("Path already exists", ERROR_CONFLICT);
      }
      await requireWrite(userId, projectId);
      const folderId = await makeFolders(projectId, folderPath, userId);
      // Mirrors the web upload chain: text-like extensions become documents,
      // binary extensions become file refs (classification lives in
      // FileSystemImportManager).
      const entity = await uploadBuffer(
        userId,
        projectId,
        folderId,
        name,
        buffer,
      );
      const entityId = idOf(entity);
      record({
        tool: "upload_file",
        userId,
        projectId,
        docId: entityId,
        path: projectPath,
      });
      return { id: entityId, path: projectPath };
    },
  };
}
