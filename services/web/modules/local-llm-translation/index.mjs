/**
 * Overleaf CE モジュール local-llm-translation のエントリーポイントです。
 *
 * CE のモジュール機構（services/web/config/settings.defaults.js の modules 一覧）から
 * 読み込まれ、webRouter へ翻訳 API のルートを登録する役割だけを持ちます。
 * UI は settings.defaults.js の railEntries と、メインエディターを中継する
 * sourceEditorToolbarComponents から読み込まれます。
 */

import LocalLlmTranslationRouter from './app/src/LocalLlmTranslationRouter.mjs'

/**
 * @import { WebModule } from "../../types/web-module"
 */

/** @type {WebModule} */
const LocalLlmTranslationModule = {
  router: LocalLlmTranslationRouter,
}

export default LocalLlmTranslationModule
