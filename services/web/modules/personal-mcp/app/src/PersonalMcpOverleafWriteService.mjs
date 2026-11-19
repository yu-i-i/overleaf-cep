// Production wiring of the personal MCP write service: injects the real
// Overleaf route-parity APIs used by the web editor/upload routes. Every
// function here only forwards to the same `promises` layer the web routes
// use, so permissions, live-editor notifications, history and auditing keep
// their canonical behaviour. The web routes themselves are not called.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import logger from "@overleaf/logger";
import AuthorizationManager from "../../../../app/src/Features/Authorization/AuthorizationManager.mjs";
import ProjectGetter from "../../../../app/src/Features/Project/ProjectGetter.mjs";
import ProjectLocator from "../../../../app/src/Features/Project/ProjectLocator.mjs";
import ProjectCreationHandler from "../../../../app/src/Features/Project/ProjectCreationHandler.mjs";
import ProjectHelper from "../../../../app/src/Features/Project/ProjectHelper.mjs";
import EditorController from "../../../../app/src/Features/Editor/EditorController.mjs";
import DocumentUpdaterHandler from "../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs";
import FileSystemImportManager from "../../../../app/src/Features/Uploads/FileSystemImportManager.mjs";
import Errors from "../../../../app/src/Features/Errors/Errors.js";
import {
  createWriteService,
  ERROR_DOC_NOT_FOUND,
} from "./PersonalMcpWriteService.mjs";

const SOURCE = "personal-mcp";

// Layer 2 authorization. canUserWriteProjectContent accepts an optional link
// token; we always pass null so members that only reach the project through a
// share/link token (tokenReadOnly / tokenReadAndWrite) can never match here.
// That mirrors how the read service hides those projects from list_projects.
async function canWrite(userId, projectId) {
  return AuthorizationManager.promises.canUserWriteProjectContent(
    userId,
    projectId,
    null,
  );
}

async function getProject(projectId) {
  return ProjectGetter.promises.getProject(projectId, { rootFolder: 1 });
}

// Resolves a doc inside the given project only. findElement throws
// NotFoundError both for "no such doc" and "doc lives in another project";
// both surface to the MCP layer as DOC_NOT_FOUND (no existence leaks).
async function findDoc(project, docId) {
  try {
    const found = await ProjectLocator.promises.findElement({
      project,
      element_id: docId,
      type: "doc",
    });
    return {
      _id: found.element._id,
      name: found.element.name,
      folderId: found.folder != null ? found.folder._id : undefined,
    };
  } catch (err) {
    if (err instanceof Errors.NotFoundError) {
      err.code = ERROR_DOC_NOT_FOUND;
    }
    throw err;
  }
}

// Existence lookup for path-conflict checks. Returns the entity (folder, doc
// or file ref) with an _id, or null when nothing lives at that path yet.
async function findEntityByPath(projectId, projectPath) {
  try {
    const found = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: projectPath,
      exactCaseMatch: true,
    });
    return found != null ? found.element : null;
  } catch (err) {
    if (err instanceof Errors.NotFoundError) return null;
    throw err;
  }
}

// Returns the id of the deepest folder in projectPath, creating missing
// parent folders through the same route-parity API as the web UI (which also
// notifies open clients about the new folders). An empty folderPath targets
// the project root folder.
async function makeFolders(projectId, folderPath, userId) {
  if (folderPath === "") {
    const project = await ProjectGetter.promises.getProject(projectId, {
      rootFolder: 1,
    });
    return project.rootFolder[0]._id;
  }
  const { lastFolder } = await EditorController.promises.mkdirp(
    projectId,
    folderPath,
    userId,
  );
  return lastFolder._id;
}

async function addDoc(userId, projectId, folderId, name, lines) {
  return EditorController.promises.addDoc(
    projectId,
    folderId,
    name,
    lines,
    SOURCE,
    userId,
  );
}

// Full-document replacement strictly via doc-updater (the real-time backend).
// doc-updater persists the new revision into history and pushes it to every
// open editor of the document, so live clients converge on the new content
// instead of silently diverging from a raw database overwrite. The returned
// rev becomes the MCP-visible version. Track-changes mode is honoured per
// user exactly like the web editor does.
async function replaceDocContent(userId, projectId, docId, lines) {
  const project = await ProjectGetter.promises.getProject(projectId, {
    track_changes: 1,
  });
  const trackChanges = ProjectHelper.isTrackChangesEnabledForUser(
    project != null ? project.track_changes : undefined,
    userId,
  );
  const result = await DocumentUpdaterHandler.promises.setDocument(
    projectId,
    docId,
    userId,
    lines,
    SOURCE,
    trackChanges,
  );
  return result != null ? result.rev : null;
}

async function deleteDoc(userId, projectId, docId) {
  // deleteEntity emits the removeEntity socket event so open editors and
  // file trees update live. Only entityType 'doc' is ever passed from the MCP
  // side; folders and assets stay out of scope.
  return EditorController.promises.deleteEntity(
    projectId,
    docId,
    "doc",
    SOURCE,
    userId,
  );
}

async function moveDoc(userId, projectId, docId, folderId) {
  // moveEntity emits reciveEntityMove so open clients follow the move live.
  return EditorController.promises.moveEntity(
    projectId,
    docId,
    folderId,
    "doc",
    userId,
    SOURCE,
  );
}

async function renameDoc(userId, projectId, docId, name) {
  // renameEntity emits reciveEntityRename for the same live effect.
  return EditorController.promises.renameEntity(
    projectId,
    docId,
    "doc",
    name,
    userId,
    SOURCE,
  );
}

// Mirrors the browser upload chain: bytes land in a temp file on disk, then
// FileSystemImportManager.addEntity classifies by extension (text-like ->
// doc with line-split content, binary -> file ref) and pushes it into the
// project. replace=false never overwrites an existing entity, and the temp
// file is always removed. The lstat symlink guard lives inside addEntity.
async function uploadBuffer(userId, projectId, folderId, name, buffer) {
  const tmpPath = path.join(
    os.tmpdir(),
    `personal-mcp-${crypto.randomBytes(12).toString("hex")}`,
  );
  await fs.promises.writeFile(tmpPath, buffer);
  try {
    return await FileSystemImportManager.promises.addEntity(
      userId,
      projectId,
      folderId,
      name,
      tmpPath,
      false,
    );
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

// Blank projects get the standard main.tex root document, exactly like the
// "Blank Project" button in the web UI.
async function createProject(userId, projectName) {
  return ProjectCreationHandler.promises.createBlankProject(
    userId,
    projectName,
  );
}

function audit({ userId, tool, projectId, docId, path: entityPath }) {
  // Audit trail for every write: ids and path only, never content.
  logger.info(
    { userId, tool, projectId, docId, path: entityPath },
    "personal-mcp: write ok",
  );
}

const PersonalMcpOverleafWriteService = createWriteService({
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
  audit,
});

export default PersonalMcpOverleafWriteService;
