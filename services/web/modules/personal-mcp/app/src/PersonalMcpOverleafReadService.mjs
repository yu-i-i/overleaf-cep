import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import {
  createReadService,
  ERROR_DOC_NOT_FOUND,
} from './PersonalMcpReadService.mjs'

// Link-token groups (tokenReadOnly/tokenReadAndWrite) are deliberately
// excluded: those projects are shared by anonymous link tokens, not granted
// to this user's account, and canUserReadProject would deny them anyway.
async function findProjects(userId) {
  const groups = await ProjectGetter.promises.findAllUsersProjects(userId, {
    _id: 1,
    name: 1,
  })
  const { tokenReadOnly, tokenReadAndWrite, ...accountGroups } = groups
  return accountGroups
}

async function findDoc(project, docId) {
  try {
    return await ProjectLocator.promises.findElement({
      project,
      element_id: docId,
      type: 'doc',
    })
  } catch (err) {
    if (err instanceof Errors.NotFoundError) err.code = ERROR_DOC_NOT_FOUND
    throw err
  }
}

async function getDoc(projectId, docId) {
  const doc = await ProjectEntityHandler.promises.getDoc(projectId, docId)
  return { lines: doc.lines, version: doc.rev ?? doc.version }
}

export default createReadService({
  findProjects,
  canRead: (userId, projectId) =>
    AuthorizationManager.promises.canUserReadProject(userId, projectId, null),
  getProject: projectId =>
    ProjectGetter.promises.getProject(projectId, { rootFolder: 1 }),
  findDoc,
  getDoc,
})
