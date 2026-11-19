import Settings from '@overleaf/settings'

// UI の登録は常時行うため、サーバーの有効状態を ExposedSettings と一致させます。
// 無効な環境ではルーター自体を読み込まず、既存の翻訳機能だけを利用できます。
const enabled = process.env.LLM_ENABLED === 'true'
Settings.llm = {
  ...Settings.llm,
  enabled,
  allowUserSettings: process.env.LLM_ALLOW_USER_SETTINGS === 'true',
}

export default enabled
  ? { router: (await import('./app/src/LLMRouter.mjs')).default }
  : {}
