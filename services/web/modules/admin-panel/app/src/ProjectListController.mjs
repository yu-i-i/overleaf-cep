import _ from 'lodash'
import moment from 'moment'
import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.js'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import PrivilegeLevels from '../../../../app/src/Features/Authorization/PrivilegeLevels.js'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.js'
import UserGetter from '../../../../app/src/Features/User/UserGetter.js'
import { OError } from '../../../../app/src/Features/Errors/Errors.js'
import { User } from '../../../../app/src/models/User.js'
import { Project } from '../../../../app/src/models/Project.js'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.js'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.js'

async function getProjectsJson(req, res) {
  const { filters, page, sort } = req.body
  const { userId } = req.params

  const projectsPage = await _getProjects(userId, filters, sort, page)
  res.json(projectsPage)
}

async function _getProjects(
  userId,
  filters = {},
  sort = { by: 'lastUpdated', order: 'desc' },
  page = { size: 20 }
) {

  const projection = {
    _id: 1,
    name: 1,
    lastUpdated: 1,
    lastUpdatedBy: 1,
    trashed: 1,
    owner_ref: 1,
  }

  const activeProjects = await Project.find(
    { owner_ref: userId },
    'name lastUpdated lastUpdatedBy trashed owner_ref'
  ).lean().exec()


  const delProjection = Object.fromEntries(
    Object.keys(projection).map(k => [`project.${k}`, 1])
  )
  delProjection['deleterData.deletedAt'] = 1
  delProjection['deleterData.deleterId'] = 1

  const deletedProjects = await DeletedProject.find(
    { 'project.owner_ref': userId },
    delProjection
  ).lean().exec()

  const formattedActiveProjects = _formatProjects(activeProjects, userId, _formatProjectInfo)
  const formattedDeletedProjects = _formatProjects(deletedProjects, userId, _formatDeletedProjectInfo)
  const formattedProjects = [...formattedActiveProjects, ...formattedDeletedProjects]

  const filteredProjects = _applyFilters(formattedProjects, filters)
  const sortedProjects = _sortAndPaginate(filteredProjects, sort, page)
  const projects = await _injectProjectUsers(sortedProjects)

  return {
    totalSize: filteredProjects.length,
    projects,
  }
}

function _formatProjects(projects, userId, formatProjectInfo) {
  const formattedProjects = []
  for (const project of projects) {
    formattedProjects.push(
      formatProjectInfo(project, userId)
    )
  }
  return formattedProjects
}

function _applyFilters(projects,  filters) {
  if (!_hasActiveFilter(filters)) {
    return projects
  }
  return projects.filter(project => _matchesFilters(project, filters))
}

function _sortAndPaginate(projects, sort, page) {
  if (
    (sort.by && !['lastUpdated', 'title', 'deletedAt'].includes(sort.by)) ||
    (sort.order && !['asc', 'desc'].includes(sort.order))
  ) {
    throw new OError('Invalid sorting criteria', { sort })
  }
  const sortedProjects = _.orderBy(
    projects,
    [sort.by || 'lastUpdated'],
    [sort.order || 'desc']
  )
  return sortedProjects
}

function _formatProjectInfo(project, userId) {
  const trashed = ProjectHelper.isTrashed(project, userId)

  return {
    id: project._id.toString(),
    name: project.name,
    owner_ref: project.owner_ref,
    lastUpdated: project.lastUpdated,
    lastUpdatedBy: project.lastUpdatedBy,
    trashed,
    deleted: false,
  }
}

function _formatDeletedProjectInfo(deletedProject, userId) {
  const project = deletedProject.project
  const trashed = ProjectHelper.isTrashed(project, userId)

  return {
    id: project._id.toString(),
    name: project.name,
    owner_ref: project.owner_ref,
    lastUpdated: project.lastUpdated,
    lastUpdatedBy: project.lastUpdatedBy,
    trashed,
    deleted: true,
    deletedAt: deletedProject.deleterData?.deletedAt,
    deleterId: deletedProject.deleterData?.deleterId,
  }
}

async function _injectProjectUsers(projects) {
  const userIds = new Set()
  for (const project of projects) {
    if (project.owner_ref != null) {
      userIds.add(project.owner_ref.toString())
    }
    if (project.lastUpdatedBy != null) {
      userIds.add(project.lastUpdatedBy.toString())
    }
    if (project.deleterId != null) {
      userIds.add(project.deleterId.toString())
    }
  }

  const projection = {
    first_name: 1,
    last_name: 1,
    email: 1,
  }
  const users = {}
  for (const user of await UserGetter.promises.getUsers(userIds, projection)) {
    const userId = user._id.toString()
    users[userId] = {
      id: userId,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    }
  }

  return projects.map(project => ({
    id: project.id,
    name: project.name,
    trashed: project.trashed,
    lastUpdated: project.lastUpdated.toISOString(),
    lastUpdatedBy:
      project.lastUpdatedBy == null
        ? null
        : users[project.lastUpdatedBy.toString()] || null,
    owner:
      project.owner_ref == null
        ? undefined
        : users[project.owner_ref.toString()],
    deleted: project.deleted,
    deletedBy:
      project.deleterId == null
        ? undefined
        : users[project.deleterId.toString()],
    deletedAt: project.deletedAt?.toISOString(),
  }))
}

function _matchesFilters(project,  filters) {
  if (filters.owned && (project.trashed || project.deleted)) {
    return false
  }
  if (filters.trashed && (!project.trashed || project.deleted)) {
    return false
  }
  if (filters.deleted && !project.deleted) {
    return false
  }
  if (
    filters.search?.length &&
    project.name.toLowerCase().indexOf(filters.search.toLowerCase()) === -1
  ) {
    return false
  }
  return true
}

function _hasActiveFilter(filters) {
  return Boolean(
    filters.owned ||
      filters.trashed ||
      filters.deleted ||
      filters.search?.length
  )
}

async function trashProjectForUser(req, res) {
  const projectId = req.params.project_id
  const userId = req.params.user_id
  await ProjectDeleter.promises.trashProject(projectId, userId)
  res.sendStatus(200)
}

async function untrashProjectForUser(req, res) {
  const projectId = req.params.project_id
  const userId = req.params.user_id
  await ProjectDeleter.promises.untrashProject(projectId, userId)
  res.sendStatus(200)
}

async function undeleteProject(req, res) {
  const projectId = req.params.Project_id
  const { userId } = req.body
  const undelededProject = await ProjectDeleter.promises.undeleteProject(projectId)
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
  getProjectsJson: expressify(getProjectsJson),
  undeleteProject: expressify(undeleteProject),
  purgeDeletedProject: expressify(purgeDeletedProject),
  trashProjectForUser: expressify(trashProjectForUser),
  untrashProjectForUser: expressify(untrashProjectForUser),
}
