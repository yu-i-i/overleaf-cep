import logger from '@overleaf/logger'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import InstanceStatsController from './InstanceStatsController.mjs'
import Settings from '@overleaf/settings'

export default {
  apply(webRouter) {
    if (!Settings.instanceStats?.enabled) {
      logger.info({ enabled: false }, 'Instance stats module disabled')
      return
    }

    logger.debug({}, 'Init instance-stats router')

    webRouter.get(
      '/admin/instance-stats',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      InstanceStatsController.page
    )

    webRouter.get(
      '/admin/instance-stats/api/series',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      InstanceStatsController.series
    )
  },
}

