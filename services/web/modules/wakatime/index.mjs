import Settings from '@overleaf/settings'
import WakaTimeRouter from './app/src/WakaTimeRouter.mjs'

Settings.wakatime = {
  enabled: process.env.WAKATIME_INTEGRATION_ENABLED !== 'false',
  debugLogging: process.env.WAKATIME_DEBUG_LOGGING === 'true',
}

const WakaTimeModule = Settings.wakatime.enabled
  ? { router: WakaTimeRouter }
  : {}

export default WakaTimeModule
