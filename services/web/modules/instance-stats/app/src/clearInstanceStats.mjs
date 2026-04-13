import logger from '@overleaf/logger'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'

function parseConfirmArg() {
  const confirmArg = process.argv.find(arg => arg.startsWith('--confirm='))
  return confirmArg ? confirmArg.slice('--confirm='.length) : undefined
}

async function main() {
  await mongoose.connectionPromise

  const confirmation =
    process.env.INSTANCE_STATS_CLEAR_CONFIRM || parseConfirmArg()
  if (confirmation !== 'YES') {
    throw new Error(
      "Refusing to clear stats. Set INSTANCE_STATS_CLEAR_CONFIRM=YES or pass --confirm=YES."
    )
  }

  const before = await InstanceStat.countDocuments({})
  const result = await InstanceStat.deleteMany({})

  logger.info(
    { before, deletedCount: result.deletedCount || 0 },
    'Cleared instance statistics'
  )
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.err({ err }, 'Failed clearing instance statistics')
    process.exit(1)
  })
