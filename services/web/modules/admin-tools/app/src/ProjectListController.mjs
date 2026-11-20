import Path from 'node:path'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import {
  parseProjectListRequest,
  buildProjectQuery,
  buildProjectPipeline,
  getProjectPageNumber,
} from './ProjectListQuery.mjs'
import { getOwnerSortedPage } from './ProjectOwnerSort.mjs'
import { fileURLToPath } from 'node:url'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

function cleanupSession(req) {
  // cleanup redirects at the end of the redirect chain
  delete req.session.postCheckoutRedirect
  delete req.session.postLoginRedirect
  delete req.session.postOnboardingRedirect
}

async function manageProjectsPage(req, res) {
  cleanupSession(req)

  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = await User.findById(userId, 'ace signUpDate')

  const userSettings = await UserSettingsHelper.buildUserSettings(
    req,
    res,
    user
  )

  res.render(Path.resolve(__dirname, '../views/manage-projects-react'), {
    title: 'Manage Projects',
    userSettings,
    initialTheme: UserSettingsHelper.getInitialTheme(userSettings.overallTheme),
  })
}

async function getProjectsJson(req, res) {
  const options = parseProjectListRequest(req)

  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const ownerId = options.userId ?? null
  const query = buildProjectQuery(options, ownerId, yearAgo)
  const model = options.filter === 'deleted' ? DeletedProject : Project
  const { totalSize, pageNumber, rows } = await getProjectPage(
    model,
    options,
    query
  )
  const format =
    options.filter === 'deleted'
      ? _formatDeletedProjectInfo
      : _formatProjectInfo

  res.json({
    totalSize,
    page: { number: pageNumber, size: options.page.size },
    projects: rows.map((project) => format(project, yearAgo)),
  })
}

async function getProjectPage(model, options, query) {
  const aggregate = pipeline =>
    model
      .aggregate(pipeline)
      .collation({ locale: 'en', strength: 2 })
      .allowDiskUse(true)
      .exec()

  if (options.sort.by === 'owner' && !options.userId) {
    const collections = {
      users: User.collection.name,
      deletedUsers: DeletedUser.collection.name,
      projects: model.collection.name,
    }
    return getOwnerSortedPage(options, query, collections, aggregate)
  }

  const totalSize = await model.countDocuments(query).exec()
  const pageNumber = getProjectPageNumber(options.page, totalSize)
  const rows = totalSize
    ? await aggregate(buildProjectPipeline(options, query, pageNumber))
    : []
  return { totalSize, pageNumber, rows }
}

function _formatProjectInfo(project, maxDate) {
  const owner_ref = project.owner_ref
  const trashed = owner_ref
    ? ProjectHelper.isTrashed(project, owner_ref)
    : false

  return {
    id: project._id.toString(),
    name: project.name,
    owner: project.owner_ref,
    lastUpdated: project.lastUpdated?.toISOString(),
    lastUpdatedBy: project.lastUpdatedBy,
    inactive: project.lastOpened < maxDate,
    trashed,
    deleted: false,
  }
}

function _formatDeletedProjectInfo(deletedProject, maxDate) {
  return {
    ..._formatProjectInfo(deletedProject.project, maxDate),
    deleted: true,
    deletedAt: deletedProject.deleterData?.deletedAt?.toISOString(),
    deleterId: deletedProject.deleterData?.deleterId,
  }
}

async function trashProjectForUser(req, res) {
  const projectId = req.params.project_id
  const { userId } = req.body
  await ProjectDeleter.promises.trashProject(projectId, userId)
  res.sendStatus(200)
}

async function untrashProjectForUser(req, res) {
  const projectId = req.params.project_id
  const { userId } = req.body
  await ProjectDeleter.promises.untrashProject(projectId, userId)
  res.sendStatus(200)
}

async function deleteProject(req, res) {
  const projectId = req.params.project_id
  const deleterId = SessionManager.getLoggedInUserId(req.session)
  const options = { deleterUser: { _id: deleterId } }
  const deletedProjectData = await ProjectDeleter.promises.deleteProject(
    projectId,
    options
  )
  return res.json(deletedProjectData)
}

async function undeleteProject(req, res) {
  const projectId = req.params.project_id
  const { userId } = req.body
  const undelededProject = await ProjectDeleter.promises.undeleteProject(
    projectId,
    { userId }
  )
  await ProjectDeleter.promises.untrashProject(projectId, userId)

  return res.json({
    name: undelededProject.name,
  })
}

async function purgeDeletedProject(req, res) {
  const projectId = req.params.project_id
  await ProjectDeleter.promises.expireDeletedProject(projectId)
  res.sendStatus(200)
}

export default {
  manageProjectsPage: expressify(manageProjectsPage),
  getProjectsJson: expressify(getProjectsJson),
  deleteProject: expressify(deleteProject),
  undeleteProject: expressify(undeleteProject),
  purgeDeletedProject: expressify(purgeDeletedProject),
  trashProjectForUser: expressify(trashProjectForUser),
  untrashProjectForUser: expressify(untrashProjectForUser),
}
