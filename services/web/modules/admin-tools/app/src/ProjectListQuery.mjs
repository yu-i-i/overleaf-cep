import _ from 'lodash'
import {
  parseReq,
  z,
  zz,
} from '../../../../app/src/infrastructure/Validation.mjs'

const FILTERS = ['owned', 'trashed', 'deleted', 'inactive']

const projectListRequestSchema = z.object({
  params: z.object({ userId: zz.coercedObjectId().nullish() }).optional(),
  body: z
    .object({
      filters: z
        .strictObject({
          owned: z.boolean().optional(),
          trashed: z.boolean().optional(),
          deleted: z.boolean().optional(),
          inactive: z.boolean().optional(),
          search: z.string().max(1000).nullish(),
        })
        .refine(filters => FILTERS.filter(key => filters[key]).length <= 1, {
          message: 'Choose one project filter',
        })
        .optional(),
      sort: z
        .object({
          by: z.enum(['lastUpdated', 'title', 'deletedAt', 'owner']).nullish(),
          order: z.enum(['asc', 'desc']).nullish(),
        })
        .optional(),
      page: z
        .object({
          size: z.number().int().min(1).max(100).nullish(),
          number: z.number().int().positive().nullish(),
        })
        .refine(
          page =>
            Number.isSafeInteger(((page.number ?? 1) - 1) * (page.size ?? 20)),
          { message: 'Invalid project page offset' }
        )
        .optional(),
    })
    .optional(),
})

export function parseProjectListRequest(req) {
  // Enforce validation; never let log-only rollout settings bypass the page limit.
  const { body, params } = parseReq(req, projectListRequestSchema)
  const { filters = {}, sort = {}, page = {} } = body ?? {}
  return {
    userId: params?.userId,
    filter: FILTERS.find(key => filters[key]) ?? 'owned',
    search: filters.search ?? '',
    sort: { by: sort.by ?? 'lastUpdated', order: sort.order ?? 'desc' },
    page: { size: page.size ?? 20, number: page.number ?? 1 },
  }
}

export function buildProjectQuery(options, ownerId, yearAgo) {
  const deleted = options.filter === 'deleted'
  const prefix = deleted ? 'project.' : ''
  const query = deleted ? { project: { $type: 'object' } } : {}
  if (ownerId) query[`${prefix}owner_ref`] = ownerId
  if (options.search) {
    query[`${prefix}name`] = {
      $regex: _.escapeRegExp(options.search),
      $options: 'i',
    }
  }
  if (!deleted) {
    // Trash is per user: only the owner's trash status matters here.
    const trashed = { $in: ['$owner_ref', { $ifNull: ['$trashed', []] }] }
    query.$expr = options.filter === 'trashed' ? trashed : { $not: [trashed] }
    if (options.filter === 'owned' || options.filter === 'trashed') {
      if (!ownerId) query.owner_ref = { $ne: null }
    }
    if (options.filter === 'inactive') {
      query.$or = [
        { lastOpened: { $type: 'date', $lt: yearAgo } },
        // Preserve the existing comparison: explicit null is old, missing is not.
        { lastOpened: { $type: 'null' } },
      ]
    }
  }
  return query
}

export function projectListProjection(deleted) {
  const prefix = deleted ? 'project.' : ''
  const fields = [
    '_id',
    'name',
    'lastUpdated',
    'lastUpdatedBy',
    'lastOpened',
    'trashed',
    'owner_ref',
  ]
  const projection = Object.fromEntries(
    fields.map(key => [`${prefix}${key}`, 1])
  )
  if (deleted) {
    projection['deleterData.deletedAt'] = 1
    projection['deleterData.deleterId'] = 1
  }
  return projection
}

export function getProjectPageNumber(page, totalSize) {
  return Math.min(page.number, Math.max(1, Math.ceil(totalSize / page.size)))
}

export function buildProjectPipeline(options, query, pageNumber) {
  const deleted = options.filter === 'deleted'
  const prefix = deleted ? 'project.' : ''
  const direction = options.sort.order === 'asc' ? 1 : -1
  // For a single owner, the first varying owner-sort field is lastUpdated.
  const field =
    options.sort.by === 'title'
      ? `${prefix}name`
      : options.sort.by === 'deletedAt'
        ? 'deleterData.deletedAt'
        : `${prefix}lastUpdated`
  return [
    { $match: query },
    { $sort: { [field]: direction, _id: direction } },
    { $skip: (pageNumber - 1) * options.page.size },
    { $limit: options.page.size },
    { $project: projectListProjection(deleted) },
  ]
}
