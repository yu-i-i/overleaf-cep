// The caller supplies the authenticated user ID; it is never accepted from
// the MCP request body. Keep permission checks next to every data access.
export const ERROR_FORBIDDEN = "FORBIDDEN";
export const ERROR_PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND";
export const ERROR_DOC_NOT_FOUND = "DOC_NOT_FOUND";

export function errorWithCode(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function createReadService({
  findProjects,
  canRead,
  getProject,
  findDoc,
  getDoc,
}) {
  async function requireRead(userId, projectId) {
    if (!(await canRead(userId, projectId))) {
      throw errorWithCode("Project access denied", ERROR_FORBIDDEN);
    }
  }

  return {
    async listProjects(userId) {
      const groups = await findProjects(userId);
      const result = [];
      for (const [role, projects] of Object.entries(groups)) {
        for (const project of projects) {
          const projectId = String(project._id);
          if (await canRead(userId, projectId)) {
            result.push({ id: projectId, name: project.name, role });
          }
        }
      }
      return result;
    },

    async listDocs(userId, projectId) {
      await requireRead(userId, projectId);
      const project = await getProject(projectId);
      if (!project) {
        throw errorWithCode("Project not found", ERROR_PROJECT_NOT_FOUND);
      }
      const docs = [];
      function visit(folder, parent = "") {
        for (const doc of folder.docs || []) {
          docs.push({ id: String(doc._id), path: `${parent}/${doc.name}` });
        }
        for (const child of folder.folders || []) {
          visit(child, `${parent}/${child.name}`);
        }
      }
      for (const root of project.rootFolder || []) visit(root);
      return docs;
    },

    async readDoc(userId, projectId, docId) {
      await requireRead(userId, projectId);
      const project = await getProject(projectId);
      if (!project) {
        throw errorWithCode("Project not found", ERROR_PROJECT_NOT_FOUND);
      }
      // The doc must belong to the requested project; a valid doc of another
      // project must not be readable by naming that other project's id.
      await findDoc(project, docId);
      const doc = await getDoc(projectId, docId);
      return { text: doc.lines.join("\n"), version: doc.version };
    },
  };
}
