import logger from '@overleaf/logger'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import InstanceStatsController from './InstanceStatsController.mjs'
import Settings from '@overleaf/settings'

export default {
  apply(webRouter, privateApiRouter) {
    if (!Settings.instanceStats?.enabled) {
      logger.info({ enabled: false }, 'Instance stats module disabled')
      return
    }

    logger.debug({}, 'Init instance-stats router')

    // N-D (2026-09-01): hourly collection via the fork's internal-API cron
    // pattern (server-ce/cron/collect-instance-stats.sh → private API),
    // same mechanism as expire-deleted-*. The collector runs IN the webapp
    // process (own Mongo connection, no env duplication for cron).
    privateApiRouter?.post(
      '/internal/collect-instance-stats',
      AuthenticationController.requirePrivateApiAuth(),
      async (req, res) => {
        try {
          const { main } = await import('./collectInstanceStats.mjs')
          await main()
          res.status(200).json({ ok: true })
        } catch (err) {
          logger.err({ err }, 'Internal instance-stats collection failed')
          res.status(500).json({ error: String(err) })
        }
      }
    )

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

    webRouter.get(
      '/admin/instance-stats/api/alert-config',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      InstanceStatsController.getAlertConfig
    )

    webRouter.put(
      '/admin/instance-stats/api/alert-config',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      InstanceStatsController.saveAlertConfig
    )

    webRouter.post(
      '/admin/instance-stats/api/send-test-alert-email',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      InstanceStatsController.sendTestAlertEmail
    )
  },
}

