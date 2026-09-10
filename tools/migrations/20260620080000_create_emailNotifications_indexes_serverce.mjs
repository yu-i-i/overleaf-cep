import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

// Tagged `server-ce` only: upstream `server-pro`/`saas` already create these
// indexes via their own migration chain (20251016112728, 20251023094210,
// 20251222142959). Reproduced here so CE docker deploys (which run
// `migrate -t server-ce`) get the same terminal index state, in particular
// the 24h TTL on `project_id` that keeps dead-lettered `emailNotifications`
// documents from accumulating.
const tags = ['server-ce']

const indexes = [
  {
    key: {
      project_id: 1,
    },
    name: 'project_id_1',
    expireAfterSeconds: 60 * 60 * 24, // expire after 24 hours
  },
]

const migrate = async () => {
  const emailNotifications = await getCollectionInternal('emailNotifications')
  await Helpers.addIndexesToCollection(emailNotifications, indexes)
}

const rollback = async () => {
  const emailNotifications = await getCollectionInternal('emailNotifications')
  await Helpers.dropIndexesFromCollection(emailNotifications, indexes)
}

export default {
  tags,
  migrate,
  rollback,
}
