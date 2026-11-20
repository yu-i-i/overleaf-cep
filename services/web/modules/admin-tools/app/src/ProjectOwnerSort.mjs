import {
  buildProjectPipeline,
  getProjectPageNumber,
  projectListProjection,
} from './ProjectListQuery.mjs'

// Bound the directory lookups, BSON arrays and owner IDs sent to the web worker.
// Larger directories use a database-side sort over narrow project keys.
const MAX_BATCH_OWNERS = 256

function projectOwnerName(deleted) {
  const prefix = deleted ? '$user.' : '$'
  return {
    _id: `${prefix}_id`,
    // The minimum tuple selects the live account, then the earliest archive
    // record for duplicate snapshots, even when a name is empty.
    owner: [
      { $literal: deleted ? 1 : 0 },
      '$_id',
      {
        last: { $ifNull: [`${prefix}last_name`, ''] },
        first: { $ifNull: [`${prefix}first_name`, ''] },
      },
    ],
  }
}

const unpackOwner = { $set: { owner: { $arrayElemAt: ['$owner', 2] } } }

const ownerNameKey = {
  missing: { $cond: [{ $ifNull: ['$owner', false] }, 0, 1] },
  lastMissing: { $cond: [{ $eq: ['$owner.last', ''] }, 1, 0] },
  last: { $ifNull: ['$owner.last', ''] },
  firstMissing: { $cond: [{ $eq: ['$owner.first', ''] }, 1, 0] },
  first: { $ifNull: ['$owner.first', ''] },
}

function nameSort(prefix, direction) {
  return Object.fromEntries(
    Object.keys(ownerNameKey).map(key => [`${prefix}.${key}`, direction])
  )
}

function buildOwnerSummary(options, query, collections) {
  const ownerField =
    options.filter === 'deleted' ? '$project.owner_ref' : '$owner_ref'
  const direction = options.sort.order === 'asc' ? 1 : -1
  return [
    { $match: query },
    { $group: { _id: ownerField, count: { $sum: 1 } } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalSize: { $sum: '$count' },
              ownerCount: { $sum: 1 },
              firstOwnerId: { $first: '$_id' },
            },
          },
        ],
        buckets: [
          { $limit: MAX_BATCH_OWNERS + 1 },
          {
            $group: {
              _id: null,
              owners: { $push: '$$ROOT' },
              size: { $sum: 1 },
            },
          },
          // With zero or one owner there is no name comparison. Above the
          // bound, skip both lookups and let the large-directory query run.
          { $match: { size: { $gt: 1, $lte: MAX_BATCH_OWNERS } } },
          {
            $lookup: {
              from: collections.users,
              localField: 'owners._id',
              foreignField: '_id',
              pipeline: [{ $project: projectOwnerName(false) }],
              as: 'live',
            },
          },
          {
            $set: {
              missingIds: {
                $setDifference: [
                  '$owners._id',
                  { $concatArrays: ['$live._id', [null]] },
                ],
              },
            },
          },
          {
            $lookup: {
              from: collections.deletedUsers,
              localField: 'missingIds',
              foreignField: 'user._id',
              let: { needed: { $gt: [{ $size: '$missingIds' }, 0] } },
              pipeline: [
                { $match: { $expr: '$$needed', 'user._id': { $ne: null } } },
                { $project: projectOwnerName(true) },
                // Several archive records can refer to the same account.
                { $group: { _id: '$_id', owner: { $min: '$owner' } } },
              ],
              as: 'archived',
            },
          },
          {
            $project: {
              entries: { $concatArrays: ['$owners', '$live', '$archived'] },
            },
          },
          { $unwind: '$entries' },
          {
            $group: {
              _id: '$entries._id',
              count: { $sum: '$entries.count' },
              owner: { $min: '$entries.owner' },
            },
          },
          unpackOwner,
          {
            $group: {
              _id: ownerNameKey,
              count: { $sum: '$count' },
              ownerIds: { $push: '$_id' },
            },
          },
          { $sort: nameSort('_id', direction) },
          { $project: { _id: 0, count: 1, ownerIds: 1 } },
        ],
      },
    },
  ]
}

// Only the first bucket has an offset. Owners with equivalent names share a
// bucket so their projects are interleaved by date and by the record's _id.
function buildOwnerBucketPage(options, query, buckets, offset) {
  const deleted = options.filter === 'deleted'
  const prefix = deleted ? 'project.' : ''
  const ownerField = `${prefix}owner_ref`
  let index = 0
  while (offset >= buckets[index].count) {
    offset -= buckets[index].count
    index++
  }
  const selected = []
  let covered = -offset
  while (covered < options.page.size && index < buckets.length) {
    const bucket = buckets[index]
    index++
    selected.push(bucket.ownerIds)
    covered += bucket.count
  }
  const direction = options.sort.order === 'asc' ? 1 : -1
  const pipeline = [
    { $match: { $and: [query, { [ownerField]: { $in: selected.flat() } }] } },
  ]
  const sort = {}
  if (selected.length > 1) {
    pipeline.push({
      $set: {
        ownerRank: {
          $switch: {
            branches: selected.map((ids, rank) => ({
              case: {
                $in: [{ $ifNull: [`$${ownerField}`, null] }, { $literal: ids }],
              },
              then: rank,
            })),
            default: selected.length,
          },
        },
      },
    })
    sort.ownerRank = 1
  }
  sort[`${prefix}lastUpdated`] = direction
  sort._id = direction
  return [
    ...pipeline,
    { $sort: sort },
    { $skip: offset },
    { $limit: options.page.size },
    { $project: projectListProjection(deleted) },
  ]
}

// Read each directory once. Partition the three streams by owner to attach the
// name to each narrow project key. Only the requested page needs full metadata.
function buildLargeOwnerPage(
  options,
  query,
  direction,
  offset,
  limit,
  collections
) {
  const deleted = options.filter === 'deleted'
  const prefix = deleted ? 'project.' : ''
  return [
    { $match: query },
    {
      $project: {
        _id: { $ifNull: [`$${prefix}owner_ref`, null] },
        recordId: '$_id',
        updated: `$${prefix}lastUpdated`,
      },
    },
    {
      $unionWith: {
        coll: collections.users,
        pipeline: [{ $project: projectOwnerName(false) }],
      },
    },
    {
      $unionWith: {
        coll: collections.deletedUsers,
        pipeline: [
          { $match: { 'user._id': { $ne: null } } },
          { $project: projectOwnerName(true) },
        ],
      },
    },
    {
      $setWindowFields: {
        partitionBy: '$_id',
        output: { owner: { $min: '$owner' } },
      },
    },
    { $match: { recordId: { $exists: true } } },
    unpackOwner,
    { $set: { nameKey: ownerNameKey } },
    {
      $sort: {
        ...nameSort('nameKey', direction),
        updated: direction,
        recordId: direction,
      },
    },
    { $skip: offset },
    { $limit: limit },
    {
      $lookup: {
        from: collections.projects,
        localField: 'recordId',
        foreignField: '_id',
        pipeline: [{ $project: projectListProjection(deleted) }],
        as: 'row',
      },
    },
    { $unwind: '$row' },
    { $replaceWith: '$row' },
  ]
}

export async function getOwnerSortedPage(
  options,
  query,
  collections,
  aggregate
) {
  const [summary] = await aggregate(
    buildOwnerSummary(options, query, collections)
  )
  const totals = summary.totals[0]
  if (!totals) return { totalSize: 0, pageNumber: 1, rows: [] }

  const { totalSize, ownerCount, firstOwnerId } = totals
  const pageNumber = getProjectPageNumber(options.page, totalSize)
  const offset = (pageNumber - 1) * options.page.size
  let rows
  if (ownerCount === 1) {
    const field =
      options.filter === 'deleted' ? 'project.owner_ref' : 'owner_ref'
    const ownerQuery = { $and: [query, { [field]: firstOwnerId }] }
    rows = await aggregate(
      buildProjectPipeline(options, ownerQuery, pageNumber)
    )
  } else if (summary.buckets.length) {
    rows = await aggregate(
      buildOwnerBucketPage(options, query, summary.buckets, offset)
    )
  } else {
    // The unique final sort key makes the opposite ordering an exact reversal.
    // Keep the DB's top-k sort small on pages near the end of a large result.
    const limit = Math.min(options.page.size, totalSize - offset)
    const fromEnd = totalSize - offset - limit
    const reverse = fromEnd < offset
    const direction = options.sort.order === 'asc' ? 1 : -1
    rows = await aggregate(
      buildLargeOwnerPage(
        options,
        query,
        reverse ? -direction : direction,
        reverse ? fromEnd : offset,
        limit,
        collections
      )
    )
    if (reverse) rows.reverse()
  }
  return { totalSize, pageNumber, rows }
}
