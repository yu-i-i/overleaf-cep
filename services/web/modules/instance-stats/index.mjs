import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

let InstanceStatsModule = {}

if (process.env.INSTANCE_STATS_ENABLED === 'true') {
  logger.debug({}, 'Enabling instance-stats module')

  Settings.instanceStats = {
    enabled: true,
    retentionDays: parseInt(process.env.INSTANCE_STATS_RETENTION_DAYS, 10) || 365,
    userSegmentation: {
      // When enabled, active_users and user_count are split into [standard, guest]
      // using users whose adminRoles array contains "guest-user".
      enabled: process.env.INSTANCE_STATS_USER_SEGMENTATION_ENABLED === 'true',
    },
  }

  const { default: InstanceStatsRouter } = await import('./app/src/InstanceStatsRouter.mjs')
  InstanceStatsModule = {
    router: InstanceStatsRouter,
  }
}

export default InstanceStatsModule
