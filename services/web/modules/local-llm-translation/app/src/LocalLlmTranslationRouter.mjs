/**
 * 翻訳 API のルート定義です。
 *
 * すべてのエンドポイントに公式 CE の認証・認可・レート制限ミドルウェアを
 * そのまま適用しています。ブラウザーが呼び出すのは Overleaf の同一オリジン API
 * だけであり、Overleaf がログイン確認とプロジェクト権限の確認をした後に
 * 内部ネットワークの翻訳サービスへ中継します（LLM の API キーは中継先のみが知ります）。
 */

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LocalLlmTranslationController from './LocalLlmTranslationController.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'

// 翻訳は LLM を消費する処理なので、ユーザー行動全体と翻訳単位の両方で制限します。
const translateLimiter = new RateLimiter('local-llm-translation', {
  points: 40,
  duration: 10 * 60,
})

export default {
  apply(webRouter) {
    // 利用可能な LLM モデル一覧（翻訳パネルの選択欄用）。ログイン必須。
    webRouter.get(
      '/local-llm/models',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(translateLimiter, { ipOnly: true }),
      LocalLlmTranslationController.getModels
    )

    // プロジェクトの翻訳設定（用語集・モデル・文体メモ）の読み込み。
    // プロジェクトの読み取り権限が必要です。
    webRouter.get(
      '/project/:Project_id/local-llm/settings',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      LocalLlmTranslationController.getSettings
    )

    // 翻訳設定の保存。プロジェクト本文の書き込み権限が必要です。
    webRouter.put(
      '/project/:Project_id/local-llm/settings',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      LocalLlmTranslationController.putSettings
    )

    // 翻訳では設定保存・選択範囲への適用も行うため、本文の書き込み権限を要します。
    webRouter.post(
      '/project/:Project_id/local-llm/translate',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      RateLimiterMiddleware.rateLimit(translateLimiter, {
        params: ['Project_id'],
      }),
      LocalLlmTranslationController.translate
    )

    // 英語版 .en.tex 文書の作成・上書き保存。書き込み権限が必要です。
    webRouter.put(
      '/project/:Project_id/local-llm/english-document',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      LocalLlmTranslationController.saveEnglishDocument
    )
  },
}
