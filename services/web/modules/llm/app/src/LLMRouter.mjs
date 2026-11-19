// プロジェクトの読取権限、本人ログイン、サイト管理者権限を入口で検証します。
// 個人接続の許可は設定ハンドラーでも検証し、URL直アクセスによる迂回を防ぎます。

import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LLMChatController from './LLMChatController.mjs'
import LLMSettingsController from './LLMSettingsController.mjs'
import LLMAdminController from './LLMAdminController.mjs'

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

    webRouter.post(
      '/project/:Project_id/llm/chat',
      AuthorizationMiddleware.ensureUserCanReadProject,
      LLMChatController.chat
    )

    webRouter.get(
      '/project/:Project_id/llm/models',
      AuthorizationMiddleware.ensureUserCanReadProject,
      LLMChatController.getModels
    )

    webRouter.get(
      '/project/:Project_id/llm/features',
      AuthorizationMiddleware.ensureUserCanReadProject,
      LLMChatController.getFeatures
    )

    webRouter.get(
      '/user/llm/selected-model',
      AuthenticationController.requireLogin(),
      LLMSettingsController.getSelectedModel
    )

    webRouter.post(
      '/user/llm/selected-model',
      AuthenticationController.requireLogin(),
      LLMSettingsController.saveSelectedModel
    )

    webRouter.get(
      '/user/llm-providers',
      AuthenticationController.requireLogin(),
      LLMSettingsController.getProvidersJson
    )

    webRouter.post(
      '/user/llm-providers',
      AuthenticationController.requireLogin(),
      LLMSettingsController.addProvider
    )

    webRouter.post(
      '/user/llm-providers/check',
      AuthenticationController.requireLogin(),
      LLMSettingsController.checkProviderConnection
    )

    webRouter.post(
      '/user/llm-providers/scan',
      AuthenticationController.requireLogin(),
      LLMSettingsController.scanProviderModels
    )

    webRouter.post(
      '/user/llm-providers/:id',
      AuthenticationController.requireLogin(),
      LLMSettingsController.updateProvider
    )

    webRouter.post(
      '/user/llm-providers/:id/delete',
      AuthenticationController.requireLogin(),
      LLMSettingsController.deleteProvider
    )

    webRouter.get(
      '/user/llm-feature-models',
      AuthenticationController.requireLogin(),
      LLMSettingsController.getFeatureModels
    )

    webRouter.post(
      '/user/llm-feature-models',
      AuthenticationController.requireLogin(),
      LLMSettingsController.saveFeatureModels
    )
    webRouter.get(
      '/user/llm-usage',
      AuthenticationController.requireLogin(),
      LLMSettingsController.userUsageSummary
    )

    webRouter.get(
      '/user/llm-settings',
      AuthenticationController.requireLogin(),
      LLMSettingsController.llmSettingsPage
    )

    if (Settings.llm && Settings.llm.allowUserSettings) {
      logger.debug({}, '[LLM] BYO enabled by deployment config')
    } else {
      logger.debug(
        { allowUserSettings: Settings.llm?.allowUserSettings },
        '[LLM] BYO endpoints registered but gated (LLM_ALLOW_USER_SETTINGS not set -> 403)'
      )
    }

    logger.info({}, '[LLM] All routes registered successfully')

    webRouter.get(
      '/admin/llm/settings',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      LLMAdminController.adminSettingsPage
    )

    webRouter.get(
      '/admin/llm/settings/json',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      LLMAdminController.getAdminSettings
    )

    webRouter.post(
      '/admin/llm/settings',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      LLMAdminController.saveAdminSettings
    )

    webRouter.post(
      '/admin/llm/settings/check',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      LLMAdminController.checkAdminLLMConnection
    )

    webRouter.post(
      '/admin/llm/models',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      LLMAdminController.scanAdminModels
    )

    webRouter.get(
      '/admin/llm/usage',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      LLMAdminController.usageSummary
    )
  },
}
