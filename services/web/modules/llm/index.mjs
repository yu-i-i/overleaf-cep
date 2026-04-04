import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

let LLMModule = {}

// LLM module is enabled when LLM_ENABLED env is set or llm.enabled in settings
const llmEnabled =
    process.env.LLM_ENABLED === 'true' ||
    (Settings.llm && Settings.llm.enabled !== false)

logger.info(
    {
        LLM_ENABLED: process.env.LLM_ENABLED,
        LLM_API_URL: process.env.LLM_API_URL ? '(set)' : '(not set)',
        LLM_API_KEY: process.env.LLM_API_KEY ? '(set)' : '(not set)',
        LLM_MODEL_NAME: process.env.LLM_MODEL_NAME,
        LLM_ALLOW_USER_SETTINGS: process.env.LLM_ALLOW_USER_SETTINGS,
        settingsLlm: Settings.llm,
        llmEnabled,
    },
    '[LLM] Module init: environment check'
)

if (llmEnabled) {
    const { default: LLMRouter } = await import('./app/src/LLMRouter.mjs')

    // Configure LLM settings from environment
    Settings.llm = Settings.llm || {}
    Settings.llm.enabled = true
    Settings.llm.allowUserSettings =
        process.env.LLM_ALLOW_USER_SETTINGS === 'true' ||
        (Settings.llm.allowUserSettings ?? true)

    logger.info(
        {
            llmSettings: Settings.llm,
            routerType: typeof LLMRouter,
            hasApply: typeof LLMRouter?.apply,
        },
        '[LLM] Module loaded successfully'
    )

    LLMModule = {
        name: 'llm',
        router: LLMRouter,
    }
} else {
    logger.info({}, '[LLM] Module NOT loaded (disabled)')
}

export default LLMModule
