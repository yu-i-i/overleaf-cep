import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LLMChatController from './LLMChatController.mjs'
import LLMSettingsController from './LLMSettingsController.mjs'
import LLMAdminController from './LLMAdminController.mjs'
import LLMComplianceController from './LLMComplianceController.mjs'

export default {
    apply(webRouter) {
        logger.info(
            {
                allowUserSettings: Settings.llm?.allowUserSettings,
                apiUrl: process.env.LLM_API_URL ? '(set)' : '(not set)',
                apiKey: process.env.LLM_API_KEY ? '(set)' : '(not set)',
                modelName: process.env.LLM_MODEL_NAME,
            },
            '[LLM] Registering routes'
        )

        // Chat and model endpoints (project-scoped)
        webRouter.post(
            '/project/:Project_id/llm/chat',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.chat
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/chat')

        webRouter.get(
            '/project/:Project_id/llm/models',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getModels
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/models')

        // overleaf-lab: per-feature enable flags for the project UI.
        webRouter.get(
            '/project/:Project_id/llm/features',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getFeatures
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/features')

        // overleaf-lab: source lines around a compile-error line for "Ask AI about this error"
        webRouter.get(
            '/project/:Project_id/llm/source-context',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getSourceContext
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/source-context')

        // overleaf-lab: effective editable prompts (Ask AI system prompt, error
        // instruction block, and per-action templates) for the project UI.
        webRouter.get(
            '/project/:Project_id/llm/prompts',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getPrompts
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/prompts')

        // Inline completion endpoint (project-scoped)
        webRouter.post(
            '/project/:Project_id/llm/completion',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.completion
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/completion')

        // overleaf-lab: PR item 13 — whole-document generators (title/abstract/keywords)
        webRouter.post(
            '/project/:Project_id/llm/generate',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.generateDocument
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/generate')

        // overleaf-lab: document compliance review endpoints (project-scoped)
        webRouter.get(
            '/project/:Project_id/llm/compliance/rubrics',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.getRubrics
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/compliance/rubrics')

        webRouter.post(
            '/project/:Project_id/llm/compliance/start',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.startReview
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/compliance/start')

        webRouter.get(
            '/project/:Project_id/llm/compliance/status/:jobId',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.statusReview
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/compliance/status/:jobId')

        webRouter.post(
            '/project/:Project_id/llm/compliance/cancel/:jobId',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.cancelReview
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/compliance/cancel/:jobId')

        // User LLM settings (only if allowed)
        if (Settings.llm && Settings.llm.allowUserSettings) {
            webRouter.get(
                '/user/llm-settings',
                AuthenticationController.requireLogin(),
                LLMSettingsController.llmSettingsPage
            )
            logger.debug({}, '[LLM] Route registered: GET /user/llm-settings')

            webRouter.get(
                '/user/llm-settings/json',
                AuthenticationController.requireLogin(),
                LLMSettingsController.getLLMSettingsJson
            )
            logger.debug({}, '[LLM] Route registered: GET /user/llm-settings/json')
        } else {
            logger.debug(
                { allowUserSettings: Settings.llm?.allowUserSettings },
                '[LLM] Skipping /user/llm-settings route (user settings disabled)'
            )
        }

        webRouter.post(
            '/user/llm-settings/check',
            AuthenticationController.requireLogin(),
            LLMSettingsController.checkLLMConnection
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-settings/check')

        webRouter.post(
            '/user/llm-settings/models',
            AuthenticationController.requireLogin(),
            LLMSettingsController.scanUserModels
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-settings/models')

        webRouter.post(
            '/user/llm-settings',
            AuthenticationController.requireLogin(),
            LLMSettingsController.saveLLMSettings
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-settings')

        logger.info({}, '[LLM] All routes registered successfully')

        // Admin routes
        webRouter.get(
            '/admin/llm/settings',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.adminSettingsPage
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/settings')

        webRouter.get(
            '/admin/llm/settings/json',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.getAdminSettings
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/settings/json')

        webRouter.post(
            '/admin/llm/settings',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.saveAdminSettings
        )
        logger.debug({}, '[LLM] Route registered: POST /admin/llm/settings')

        webRouter.post(
            '/admin/llm/settings/check',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.checkAdminLLMConnection
        )
        logger.debug({}, '[LLM] Route registered: POST /admin/llm/settings/check')

        webRouter.post(
            '/admin/llm/models',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.scanAdminModels
        )
        logger.debug({}, '[LLM] Route registered: POST /admin/llm/models')
    },
}
