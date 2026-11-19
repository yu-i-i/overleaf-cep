// 個人接続はセッションの本人IDに結び付けて保存します。
// APIキーを返さずhasKeyだけを公開し、更新時の空欄は既存キー保持として扱います。

/*
 * LLMSettingsController - bring-your-own (BYO) LLM provider rows.
 *
 * Data model (per user):
 *   User.llmProviders: [ {
 *     id              string   (8 hex chars)
 *     name            string   (1..80)
 *     providerType    'openai' | 'anthropic' | 'openaiCompatible'
 *     baseUrl         string   (required for openaiCompatible; default endpoints
 *                              used when empty for openai/anthropic)
 *     apiKey          string   (encrypted at rest via LLMCrypto; '' = keyless)
 *     models          string[] (1..100)
 *     completionModel string   (optional; must be one of models)
 *     enabled         boolean
 *     createdAt       string   (ISO timestamp)
 *   } ]
 *
 * Legacy single-connection settings (llmApiUrl/llmApiKey/llmModelName/...)
 * are migrated to row #1 on first read/write when present.
 *
 * Every endpoint here is gated by LLM_ALLOW_USER_SETTINGS (F1 fix: the gate
 * previously only enforced chat(), not settings/check/scan/save).
 */

import { getUsageSummary } from './LLMUsage.mjs' // overleaf-lab (usage meter)
import { z } from 'zod'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { expressify } from '@overleaf/promise-utils'
import {
  encryptSecret,
  normalizeStoredSecret,
  storedToPlaintext,
} from './LLMCrypto.mjs'
import {
  normalizeProviderSpec,
  chatText,
  listModels,
  detectProviderType,
  PROVIDER_TYPES,
  assertPublicLlmBaseUrl,
} from './LLMClient.mjs'
import {
  sanitizeComplianceRubrics,
  validateComplianceRubrics,
  getComplianceRubrics,
  getLLMFeatureFlags,
} from './LLMAdminController.mjs'
import OError from '@overleaf/o-error'

// overleaf-lab: hard cap on rows per user - keeps the editor model list and
// the user document bounded.
const MAX_PROVIDERS_PER_USER = 10
const MAX_ROWS_IN_LIST = 500 // listModels result cap

export const rowSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    providerType: z.enum(['openai', 'anthropic', 'openaiCompatible']),
    baseUrl: z.string().trim().max(500).optional().default(''),
    apiKey: z.string().trim().max(2000).optional().default(''),
    models: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    completionModel: z.string().trim().max(200).optional().default(''),
    enabled: z.boolean().optional().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.providerType === 'openaiCompatible' && !value.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'A base URL is required for OpenAI-compatible providers',
      })
    }
    if (
      value.completionModel &&
      !value.models.includes(value.completionModel)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completionModel'],
        message: 'completionModel must be one of the listed models',
      })
    }
  })

function makeRowId() {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

/*
 * F1: the single source of truth for "is BYO allowed on this deployment?".
 * Used by every user-facing LLM endpoint (settings CRUD, check/scan, and the
 * user-lane branches of chat/completion in LLMChatController).
 */
export function isUserSettingsAllowed() {
  return process.env.LLM_ALLOW_USER_SETTINGS === 'true'
}

async function requireUserSettingsAllowed(req, res) {
  if (isUserSettingsAllowed()) return true
  logger.info(
    { userId: req.session?.userId },
    '[LLM] Blocked BYO settings access (LLM_ALLOW_USER_SETTINGS not set)'
  )
  res
    .status(403)
    .json({
      ok: false,
      error: 'disabled',
      message: 'Bring-your-own LLM settings are disabled on this deployment',
    })
  return false
}

function publicRow(row) {
  return {
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl || '',
    hasKey: !!row.apiKey,
    models: row.models,
    completionModel: row.completionModel || '',
    enabled: row.enabled !== false,
    createdAt: row.createdAt || new Date(0).toISOString(),
  }
}

/*
 * Load the user's provider rows, migrating legacy single-connection settings
 * to row #1 (virtually, without writing) when present.
 */
export async function loadProviders(userId) {
  const user = await User.findById(
    userId,
    'llmProviders llmApiUrl llmApiType llmApiKey llmModelName llmModels llmModelNames llmCompletionModel llmCompletionModels useOwnLLMSettings'
  )
  if (!user) return []

  const providers = Array.isArray(user.llmProviders)
    ? user.llmProviders.filter(r => r?.id && Array.isArray(r?.models))
    : []

  // Legacy settings (one single saved connection) are always represented
  // as the "Imported settings" row, next to any BYO rows. F20: the legacy
  // plaintext key is encrypted on migration; the row is persisted (if still
  // not present) so save/edit/delete operate on a real row with an
  // encrypted key. Making the row visible when other rows exist is
  // required for delete (the delete of that row is what unsets the legacy
  // fields — owner bug report: "row reappears after delete / can't delete").
  if (
    user.llmApiUrl &&
    !providers.some(
      r =>
        r.id === 'legacy' ||
        (r.name === 'Imported settings' && r.baseUrl === user.llmApiUrl)
    )
  ) {
    const models = [
      ...(user.llmModelNames || user.llmModels || []),
      ...(user.llmModelName && !user.llmModels?.includes(user.llmModelName)
        ? [user.llmModelName]
        : []),
    ]
    const completionModels = [
      ...(user.llmCompletionModels || []),
      ...(user.llmCompletionModel &&
      !user.llmCompletionModels?.includes(user.llmCompletionModel)
        ? [user.llmCompletionModel]
        : []),
    ]
    const legacyType = ['openai', 'anthropic', 'openaiCompatible'].includes(
      user.llmApiType
    )
      ? user.llmApiType
      : null
    const row = {
      id: 'legacy',
      name: 'Imported settings',
      providerType: legacyType || detectProviderType(user.llmApiUrl),
      baseUrl: user.llmApiUrl,
      apiKey: normalizeStoredSecret(user.llmApiKey || ''),
      models: models.slice(0, 100),
      completionModel:
        completionModels[0] && models.includes(completionModels[0])
          ? completionModels[0]
          : models[0] || '',
      enabled: true,
      createdAt: new Date(0).toISOString(),
    }
    try {
      const result = await User.updateOne(
        { _id: userId },
        { $set: { llmProviders: [row, ...providers] } }
      )
      if (result && result.modifiedCount) {
        logger.info(
          { userId },
          '[LLM] loadProviders: migrated legacy settings to "Imported settings" row (key encrypted)'
        )
      }
    } catch (err) {
      logger.warn(
        { userId, err: err?.message },
        '[LLM] loadProviders: legacy migration persist failed (continuing with virtual row)'
      )
    }
    return [row, ...providers]
  }

  return providers
}

async function getProvidersJson(req, res) {
  if (!(await requireUserSettingsAllowed(req, res))) return
  const userId = SessionManager.getLoggedInUserId(req.session)
  const providers = await loadProviders(userId)
  res.json({
    ok: true,
    providers: providers.map(publicRow),
    maxProviders: MAX_PROVIDERS_PER_USER,
  })
}

// overleaf-lab (audit M1): SSRF guard for user-supplied base URLs. Returns a
// 400 response (or null when the URL is acceptable) so every entry point can
// share the same error message.
function assertPublicOr400(res, baseUrl) {
  try {
    assertPublicLlmBaseUrl(baseUrl)
    return null
  } catch (err) {
    return res
      .status(400)
      .json({ ok: false, error: 'blocked-url', details: err.message })
  }
}

async function addProvider(req, res) {
  if (!(await requireUserSettingsAllowed(req, res))) return
  const userId = SessionManager.getLoggedInUserId(req.session)
  const parsed = rowSchema.safeParse(req.body || {})
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    return res.status(400).json({ ok: false, error: 'invalid', details })
  }

  // overleaf-lab (audit M1): SSRF guard on the user-supplied base URL.
  const blocked = assertPublicOr400(res, parsed.data.baseUrl)
  if (blocked) return blocked

  const user = await User.findById(
    userId,
    'llmProviders llmApiUrl llmModelName'
  )
  const existing = Array.isArray(user?.llmProviders) ? user.llmProviders : []
  if (existing.length >= MAX_PROVIDERS_PER_USER) {
    return res
      .status(400)
      .json({
        ok: false,
        error: 'limit',
        message: `Maximum of ${MAX_PROVIDERS_PER_USER} providers`,
      })
  }
  const row = {
    ...parsed.data,
    id: makeRowId(),
    models: [...new Set(parsed.data.models)],
    apiKey: parsed.data.apiKey ? encryptSecret(parsed.data.apiKey) : '',
    createdAt: new Date().toISOString(),
  }
  // Persisting the legacy migration as row #1 too, so the virtual row gains
  // a real id on first write.
  const migrated =
    existing.length === 0
      ? (await loadProviders(userId)).map(r => ({
          ...r,
          id: r.id === 'legacy' ? makeRowId() : r.id,
          apiKey: normalizeStoredSecret(r.apiKey),
        }))
      : []
  const merged = [...migrated, ...existing, row]
  // サイト共通接続だけの利用者にも参照設定・使用量を表示します。
  // 個人の接続先を変更するAPIは、それぞれBYO許可を検証します。
  const userId = SessionManager.getLoggedInUserId(req.session)
  const rowId = req.params.id
  const user = await User.findById(
    userId,
    'llmProviders llmApiUrl llmApiKey llmModelName llmModels llmModelNames llmCompletionModel llmCompletionModels llmApiType useOwnLLMSettings'
  )
  const current = (await loadProviders(userId)).find(r => r.id === rowId)
  if (!current) return res.status(404).json({ ok: false, error: 'not-found' })

  // Partial update: merge over current row, then validate the full shape.
  const merged = {
    ...current,
    name: req.body?.name ?? current.name,
    providerType: req.body?.providerType ?? current.providerType,
    baseUrl:
      req.body?.baseUrl !== undefined
        ? req.body.baseUrl
        : current.baseUrl || '',
    models: req.body?.models ?? current.models,
    completionModel:
      req.body?.completionModel !== undefined
        ? req.body.completionModel
        : current.completionModel || '',
    enabled: req.body?.enabled ?? current.enabled,
  }
  const parsed = rowSchema.safeParse(merged)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    return res.status(400).json({ ok: false, error: 'invalid', details })
  }

  // overleaf-lab (audit M1): SSRF guard on the user-supplied base URL.
  if (assertPublicOr400(res, parsed.data.baseUrl)) return

  let apiKey = normalizeStoredSecret(current.apiKey || '')
  if (req.body?.clearApiKey) apiKey = ''
  else if (req.body?.apiKey && req.body.apiKey.trim() !== '')
    apiKey = encryptSecret(req.body.apiKey)

  const rows = (
    Array.isArray(user?.llmProviders)
      ? user.llmProviders
      : await loadProviders(userId)
  ).map(r =>
    r.id === rowId || r.id === 'legacy'
      ? {
          ...parsed.data,
          id: rowId === 'legacy' ? makeRowId() : rowId,
          apiKey,
          createdAt: new Date().toISOString(),
        }
      : r
  )
  await User.updateOne({ _id: userId }, { $set: { llmProviders: rows } })
  logger.info({ userId, rowId }, '[LLM] updateProvider: row updated')
  res.json({
    ok: true,
    provider: publicRow({ ...parsed.data, id: rowId, apiKey }),
  })
}

async function deleteProvider(req, res) {
  if (!(await requireUserSettingsAllowed(req, res))) return
  const userId = SessionManager.getLoggedInUserId(req.session)
  const rowId = req.params.id
  const providers = await loadProviders(userId)
  if (!providers.some(r => r.id === rowId))
    return res.status(404).json({ ok: false, error: 'not-found' })
  const rows =
    (await User.findById(userId, 'llmProviders')).llmProviders ||
    providers.map(r => ({
      ...r,
      id: r.id === 'legacy' ? makeRowId() : r.id,
      apiKey: normalizeStoredSecret(r.apiKey),
    }))
  const remaining = rows.filter(
    r =>
      r.id !== rowId && !(rowId === 'legacy' && r.name === 'Imported settings')
  )
  // overleaf-lab: deleting the "Imported settings" row must also clear the
  // underlying legacy single-connection fields, otherwise loadProviders()
  // re-migrates them on the next read and the deleted row comes back to life.
  const targetIsLegacy =
    providers.some(
      r =>
        r.id === rowId && (r.id === 'legacy' || r.name === 'Imported settings')
    ) ||
    (rowId === 'legacy' && providers.some(r => r.name === 'Imported settings'))
  const update = { $set: { llmProviders: remaining } }
  if (targetIsLegacy) {
    update.$unset = {
      llmApiUrl: 1,
      llmApiType: 1,
      llmApiKey: 1,
      llmModelName: 1,
      llmModels: 1,
      llmModelNames: 1,
      llmCompletionModel: 1,
      llmCompletionModels: 1,
      useOwnLLMSettings: 1,
    }
  }
  await User.updateOne({ _id: userId }, update)
  logger.info(
    { userId, rowId, targetIsLegacy },
    '[LLM] deleteProvider: row deleted'
  )
  res.json({ ok: true })
}

async function checkProviderConnection(req, res) {
  if (!(await requireUserSettingsAllowed(req, res))) return
  const userId = SessionManager.getLoggedInUserId(req.session)
  const body = req.body || {}

  // Credentials: explicit body values win, else the referenced row.
  let baseUrl = body.baseUrl || ''
  let apiKey = body.apiKey || ''
  let providerType = body.providerType || ''
  const model = body.model || ''
  if (body.rowId) {
    const row = (await loadProviders(userId)).find(r => r.id === body.rowId)
    if (!row) return res.status(404).json({ ok: false, error: 'not-found' })
    baseUrl = baseUrl || row.baseUrl || ''
    providerType = providerType || row.providerType
    if (!apiKey && row.apiKey) apiKey = storedToPlaintext(row.apiKey)
  }
  // overleaf-lab (audit M1): SSRF guard on the effective base URL.
  const blockedChk = assertPublicOr400(res, baseUrl || '')
  if (blockedChk) return blockedChk
  if (!baseUrl && !providerType)
    return res
      .status(400)
      .json({
        ok: false,
        error: 'invalid',
        details: 'baseUrl or rowId is required',
      })
  // overleaf-lab (reviewer #5): auto-detect the API type. Try the requested
  // type first; if it fails, try every other supported type before giving
  // up, so an endpoint that is OpenAI-compatible (or Anthropic) is detected
  // automatically and the UI can persist the working type on the row.
  const requestedType = providerType || detectProviderType(baseUrl)
  const candidateTypes = [
    requestedType,
    ...PROVIDER_TYPES.filter(t => t !== requestedType),
  ]

  const started = Date.now()
  let lastError = null
  for (const type of candidateTypes) {
    let spec
    try {
      spec = normalizeProviderSpec(
        { providerType: type, baseUrl, apiKey },
        { model: model || 'qwen' }
      )
    } catch (error) {
      lastError = error
      continue
    }
    try {
      const { ids } = await listModels(spec, { timeoutMs: 60000 })
      const models = ids.slice(0, MAX_ROWS_IN_LIST)
      if (model && !models.includes(model)) {
        // The model check is definitive for the requested type; do not
        // fall through to other types just because the model is missing.
        logger.warn(
          { userId, model, count: models.length },
          '[LLM] checkProviderConnection: model not in list'
        )
        return res
          .status(404)
          .json({
            ok: false,
            error: 'model-not-found',
            details: `Model "${model}" not available`,
            models,
            duration: `${Date.now() - started}ms`,
          })
      }
      // Lightweight chat probe (catches backends whose /models works but
      // chat is misconfigured).
      await chatText(
        normalizeProviderSpec(
          { providerType: type, baseUrl, apiKey },
          { model: model || models[0] || 'qwen' }
        ),
        [{ role: 'user', content: 'Reply with the single word OK.' }],
        {
          maxOutputTokens: 16,
          temperature: 0,
          timeoutMs: 60000,
          usageMeta: { userId, action: 'check', lane: 'user' }, // overleaf-lab (usage meter)
        }
      )
      if (type !== requestedType) {
        logger.info(
          { userId, requestedType, detectedType: type, models: models.length },
          '[LLM] checkProviderConnection: API type auto-detected'
        )
      }
      return res.json({
        ok: true,
        message: 'Connection successful',
        models,
        providerType: type,
        detectedProviderType: type !== requestedType ? type : undefined,
        duration: `${Date.now() - started}ms`,
      })
    } catch (error) {
      lastError = error
      logger.debug(
        { userId, type, err: error?.message },
        '[LLM] checkProviderConnection: type attempt failed, trying next'
      )
    }
  }
  const info =
    lastError?.code === 'auth'
      ? { status: 401 }
      : lastError?.status || OError.getFullInfo(lastError)?.status || 500
  logger.warn(
    { userId, providerType: requestedType, err: lastError?.message },
    '[LLM] checkProviderConnection: failed'
  )
  return res
    .status(info.status || 500)
    .json({
      ok: false,
      error: lastError?.code || 'llm-error',
      message: lastError?.message,
      duration: `${Date.now() - started}ms`,
    })
}

async function scanProviderModels(req, res) {
  if (!(await requireUserSettingsAllowed(req, res))) return
  const userId = SessionManager.getLoggedInUserId(req.session)
  const body = req.body || {}
  let baseUrl = body.baseUrl || ''
  let apiKey = body.apiKey || ''
  let providerType = body.providerType || ''
  if (body.rowId) {
    const row = (await loadProviders(userId)).find(r => r.id === body.rowId)
    if (!row) return res.status(404).json({ ok: false, error: 'not-found' })
    baseUrl = baseUrl || row.baseUrl || ''
    providerType = providerType || row.providerType
    if (!apiKey && row.apiKey) apiKey = storedToPlaintext(row.apiKey)
  }
  providerType = providerType || detectProviderType(baseUrl)
  // overleaf-lab (audit M1): SSRF guard on the effective base URL.
  const blockedScan = assertPublicOr400(res, baseUrl || '')
  if (blockedScan) return blockedScan
  if (!baseUrl)
    return res
      .status(400)
      .json({
        ok: false,
        error: 'invalid',
        details: 'baseUrl or rowId is required',
      })

  // overleaf-lab (reviewer #5): same auto-detection as /check — try the
  // requested API type first, then the others, so scanning also works when
  // the type field was guessed wrong.
  const requestedType = providerType
  const candidateTypes = [
    requestedType,
    ...PROVIDER_TYPES.filter(t => t !== requestedType),
  ]
  let lastError = null
  for (const type of candidateTypes) {
    const spec = normalizeProviderSpec(
      { providerType: type, baseUrl, apiKey },
      { model: 'scan' }
    )
    try {
      const { ids } = await listModels(spec, { timeoutMs: 60000 })
      if (type !== requestedType) {
        logger.info(
          { userId, requestedType, detectedType: type, models: ids.length },
          '[LLM] scanProviderModels: API type auto-detected'
        )
      }
      return res.json({
        ok: true,
        models: ids.slice(0, MAX_ROWS_IN_LIST),
        providerType: type,
        detectedProviderType: type !== requestedType ? type : undefined,
      })
    } catch (error) {
      lastError = error
      logger.debug(
        { userId, type, err: error?.message },
        '[LLM] scanProviderModels: type attempt failed, trying next'
      )
    }
  }
  const status =
    lastError?.code === 'auth'
      ? 401
      : lastError?.status || OError.getFullInfo(lastError)?.status || 500
  logger.warn(
    { userId, providerType: requestedType, err: lastError?.message },
    '[LLM] scanProviderModels: failed'
  )
  return res
    .status(status || 500)
    .json({
      ok: false,
      error: lastError?.code || 'llm-error',
      message: lastError?.message,
    })
}

// Redirect: BYO rows live in Account Settings (core section). Kept as a
// redirect so old bookmarks / navbar entries do not 404.
async function llmSettingsPage(req, res) {
  // overleaf-lab: dedicated BYO settings page (the Account ▸ 'AI Settings' item
  // and the Account Settings card both link here; it used to be a redirect to
  // the generic settings page, which showed no LLM UI at all).
  const allowUser = !!(Settings.llm && Settings.llm.allowUserSettings)
  // WS5: keep the page-level surface consistent with the API — disabled BYO
  // deployments answer 403 for the page as well (not just the JSON routes).
  if (!allowUser) {
    return res
      .status(403)
      .json({
        ok: false,
        error: 'disabled',
        message:
          'BYO provider settings are disabled on this deployment (LLM_ALLOW_USER_SETTINGS). Use the site backend.',
      })
  }
  const userId = SessionManager.getLoggedInUserId(req.session)
  const userDoc = userId ? await User.findOne({ _id: userId }).lean() : null
  const context = {
    user: {
      firstName: userDoc?.first_name || '',
      lastName: userDoc?.last_name || '',
      email: userDoc?.email || '',
      llmSettings: { allowed: allowUser },
    },
    featureFlags: { chatEnabled: true, completionEnabled: true },
  }
  res.render(
    new URL('../../app/views/llm-settings.pug', import.meta.url).pathname,
    context
  )
}

/*
 * overleaf-lab (owner request 2026-08-26): user-scoped shared LLM model
 * selection. The single "Select LLM Model" choice (File menu) drives every AI
 * surface (chat, review, generators, ask-AI). The selection is stored on the
 * user profile (llmSelectedModel) so it follows the user across projects and
 * browsers — not per project. Value is a model id, a namespaced
 * `u:<rowId>:<model>` BYO id, or '' (deployment default). No BYO gate here:
 * picking the site model is always allowed; a BYO value simply 403s at run
 * time on deployments without LLM_ALLOW_USER_SETTINGS.
 */
const SELECTED_MODEL_MAX = 500

async function getSelectedModel(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const userDoc = await User.findOne({ _id: userId }).lean()
  const selected =
    typeof userDoc?.llmSelectedModel === 'string'
      ? userDoc.llmSelectedModel
      : ''
  res.json({ ok: true, selected })
}

async function saveSelectedModel(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const value =
    typeof req.body?.selected === 'string' ? req.body.selected.trim() : ''
  if (value.length > SELECTED_MODEL_MAX) {
    return res
      .status(400)
      .json({
        ok: false,
        error: 'bad-request',
        message: 'Model value too long',
      })
  }
  // overleaf-lab (harden): a broken selection here silently downgrades EVERY
  // AI surface to fallback lanes — only accept a well-formed model reference
  // (`name`, `name:tag`, `site:name`, or `u:<rowId>:name`) or the empty
  // string (explicit reset). Anything else is a client bug, not a model.
  if (value && !/^[A-Za-z0-9._\-/]+(:[A-Za-z0-9._\-/]+){0,2}$/.test(value)) {
    return res
      .status(400)
      .json({
        ok: false,
        error: 'bad-request',
        message: 'Invalid model reference',
      })
  }
  await User.updateOne({ _id: userId }, { $set: { llmSelectedModel: value } })
  res.json({ ok: true, selected: value })
}

// 翻訳専用設定（Phase 2・日本語コメント）: 翻訳レールが使う接続先を、ユーザーの
// BYO 行（OpenAI / OpenAI 互換のみ。翻訳サービスは Anthropic API を話せないため
// 除外）から 1 つ選ぶ欄です。設定値は User.llmTranslation に保存し、翻訳依頼の
// 時に LocalLlmTranslationController が読み取って翻訳サービスへオーバーライドと
// して渡します。秘密値（API キー）は持たず、鍵は常に llmProviders 側の暗号化値。
// providerId 空欄 = 翻訳サービス側の標準設定（エンドポイント保存設定 > .env）。
const translationSettingsSchema = z
  .object({
    providerId: z.string().trim().max(64).optional().default(''),
    model: z.string().trim().max(256).optional().default(''),
    minimal: z.boolean().optional().default(false),
    chunkChars: z.number().int().min(0).max(200000).optional().default(0),
  })
  .strict()

function normalizeTranslationSettings(raw) {
  return {
    providerId: typeof raw?.providerId === 'string' ? raw.providerId : '',
    model: typeof raw?.model === 'string' ? raw.model : '',
    minimal: !!raw?.minimal,
    chunkChars: Number.isFinite(raw?.chunkChars) ? raw.chunkChars : 0,
  }
}

async function getTranslationSettings(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const userDoc = await User.findOne({ _id: userId }).lean()
  res.json({
    ok: true,
    settings: normalizeTranslationSettings(userDoc?.llmTranslation),
  })
}

async function saveTranslationSettings(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const parsed = translationSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({
        ok: false,
        error: 'bad-request',
        message: 'Invalid translation settings',
      })
  }
  const settings = normalizeTranslationSettings(parsed.data)
  if (settings.providerId) {
    // 接続先を選ぶ場合は、自分の BYO 行の OpenAI / OpenAI 互換行だけを許します
    // （BYO 機能が停止中のデプロイでは行そのものが使えないため 400）。
    if (!isUserSettingsAllowed()) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'bad-request',
          message: 'BYO providers are disabled on this deployment',
        })
    }
    const rows = await loadProviders(userId)
    const row = rows.find(
      r => r.id === settings.providerId && r.enabled !== false
    )
    if (!row || !['openai', 'openaiCompatible'].includes(row.providerType)) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'bad-request',
          message: 'Unknown translation provider row',
        })
    }
    // 接続先行のモデル一覧に無いモデルは選ばない（一覧再取得で消えたモデル対策）。
    if (
      settings.model &&
      Array.isArray(row.models) &&
      !row.models.includes(settings.model)
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'bad-request',
          message: 'Model is not listed on the selected provider row',
        })
    }
  } else {
    // 標準設定に従う場合は翻訳専用欄側のモデル指定も無効化します
    // （翻訳サービス側のプロジェクト設定・エンドポイント設定が優先されるため）。
    settings.model = ''
  }
  await User.updateOne({ _id: userId }, { $set: { llmTranslation: settings } })
  res.json({ ok: true, settings })
}

// 翻訳依頼の時に LocalLlmTranslationController が呼ぶ解決関数（Phase 2）。
// ユーザーの翻訳専用設定が BYO 行を指していれば、接続オーバーライド
// { baseUrl, apiKey(平文), model, minimal, chunkChars } を返します。
// 未設定・標準設定跟随・BYO 停止中・行が消えた/Anthropic の場合は null を返し、
// 翻訳サービス側の従来チェーン（プロジェクト endpoint > 標準 > .env）に任せます。
export async function resolveTranslationOverride(userId) {
  const userDoc = await User.findOne({ _id: userId }).lean()
  const settings = normalizeTranslationSettings(userDoc?.llmTranslation)
  if (!settings.providerId || !isUserSettingsAllowed()) return null
  const rows = await loadProviders(userId)
  const row = rows.find(
    r => r.id === settings.providerId && r.enabled !== false
  )
  if (!row || !['openai', 'openaiCompatible'].includes(row.providerType))
    return null
  // openai 公式行は baseUrl 空欄が既定仕様 → 公式 URL を補います。
  const baseUrl =
    (row.baseUrl || '').trim() ||
    (row.providerType === 'openai' ? 'https://api.openai.com/v1' : '')
  if (!baseUrl) return null
  return {
    baseUrl,
    apiKey: storedToPlaintext(row.apiKey) || '',
    model: settings.model,
    minimal: !!settings.minimal,
    chunkChars: Number.isFinite(settings.chunkChars) ? settings.chunkChars : 0,
  }
}

// 機能別 AI 選択（2026-11-12 の運用者要望）: チャット / Ask AI / インライン補完 /
// 生成 / コンパイル修正 / 準拠レビューについて、どの BYO 行のモデルを使うかを
// 機能ごとに保存します。値は共通モデル選択と同じ ref 書式
// （'u:<行ID>:<モデル>' かサイト側モデル名、空欄 = 共有選択に従う）。
const FEATURE_KEYS = [
  'chat',
  'ask',
  'completion',
  'generate',
  'compileFix',
  'compliance',
]
const MODEL_REF_RE = /^[A-Za-z0-9._\-/]+(:[A-Za-z0-9._\-/]+){0,2}$/

function normalizeFeatureModels(raw) {
  const out = {}
  for (const key of FEATURE_KEYS) {
    out[key] = typeof raw?.[key] === 'string' ? raw[key].trim() : ''
  }
  return out
}

async function getFeatureModels(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const userDoc = await User.findOne({ _id: userId }).lean()
  res.json({
    ok: true,
    models: normalizeFeatureModels(userDoc?.llmFeatureModels),
    // チャットのプロジェクト TeX 自動参照 ON/OFF（既定 ON）。
    chatAutoContext: userDoc?.llmChatAutoContext !== false,
    // 参照モード（auto/full/off）とコンテキスト長予算（文字数・0 = 既定）。
    chatContextMode: ['auto', 'full', 'off'].includes(
      userDoc?.llmChatContextMode
    )
      ? userDoc.llmChatContextMode
      : userDoc?.llmChatAutoContext === false
        ? 'off'
        : 'auto',
    chatContextBudget: Number.isFinite(userDoc?.llmChatContextBudget)
      ? userDoc.llmChatContextBudget
      : 0,
  })
}

async function saveFeatureModels(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const models = normalizeFeatureModels(req.body)
  // BYO 行を指す ref は、その行が実際に存在して有効であることを確認します
  // （共有選択と同じく、行の削除後は実行時に静かに従来チェーンへ降格するが、
  //   保存時に入力ミスを弾けるようにする）。
  const userRefs = FEATURE_KEYS.map(key => models[key]).filter(value =>
    value.startsWith('u:')
  )
  if (userRefs.length) {
    if (!isUserSettingsAllowed()) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'bad-request',
          message: 'BYO providers are disabled on this deployment',
        })
    }
    const rows = await loadProviders(userId)
    for (const value of userRefs) {
      const [, rowId, ...modelParts] = value.split(':')
      const model = modelParts.join(':')
      const row = rows.find(r => r.id === rowId && r.enabled !== false)
      if (!row) {
        return res
          .status(400)
          .json({
            ok: false,
            error: 'bad-request',
            message: `Unknown provider row: ${rowId}`,
          })
      }
      if (model && Array.isArray(row.models) && !row.models.includes(model)) {
        return res
          .status(400)
          .json({
            ok: false,
            error: 'bad-request',
            message: `Model is not listed on row: ${row.name}`,
          })
      }
    }
  }
  for (const value of Object.values(models)) {
    if (value && !MODEL_REF_RE.test(value)) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'bad-request',
          message: 'Invalid model reference',
        })
    }
  }
  const update = { llmFeatureModels: models }
  // チャットの自動参照設定（未指定なら変更しない）。モード指定時は旧 ON/OFF
  // フラグも同期し、旧コードからの参照互換を保ちます。
  if (typeof req.body?.chatAutoContext === 'boolean') {
    update.llmChatAutoContext = req.body.chatAutoContext
  }
  if (typeof req.body?.chatContextMode === 'string') {
    if (!['auto', 'full', 'off'].includes(req.body.chatContextMode)) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'bad-request',
          message: 'Invalid context mode',
        })
    }
    update.llmChatContextMode = req.body.chatContextMode
    update.llmChatAutoContext = req.body.chatContextMode !== 'off'
  }
  if (req.body?.chatContextBudget !== undefined) {
    const budget = Number(req.body.chatContextBudget)
    // 0（既定に戻す）か 2,000〜200,000 字。日本語で 1 字 ≈ 0.5〜1 トークンの目安。
    if (
      !(
        budget === 0 ||
        (Number.isFinite(budget) && budget >= 2000 && budget <= 200000)
      )
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'bad-request',
          message: 'Context budget must be 0 or 2000-200000',
        })
    }
    update.llmChatContextBudget = Math.floor(budget)
  }
  await User.updateOne({ _id: userId }, { $set: update })
  res.json({
    ok: true,
    models,
    chatAutoContext: update.llmChatAutoContext !== false,
  })
}

// overleaf-lab (2026-08-27, owner request): USER-SCOPED compliance review
// rubrics. Each user configures their own rubrics under /user/llm-settings; the
// compliance reviewer (LLMComplianceController) reads them per user. Storage is
// the user document (llmComplianceRubrics) — no new collection.
//
// Migration behavior: a user who has never saved their own rubrics inherits the
// deployment-wide rubrics configured by the admin, so existing setups keep
// working on the first visit.
// overleaf-lab (2026-08-27): the internal (no-auth) lookup used by the
// compliance reviewer — the user's own rubrics, falling back to the
// deployment-wide set when the user has never saved their own.
export async function getComplianceRubricsForUser(userId) {
  const userDoc = await User.findOne({ _id: userId })
    .lean()
    .catch(() => null)
  const mine =
    Array.isArray(userDoc?.llmComplianceRubrics) &&
    userDoc.llmComplianceRubrics.length
      ? userDoc.llmComplianceRubrics
      : null
  if (mine) return mine
  return getComplianceRubrics()
}

async function getUserCompliance(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const flags = await getLLMFeatureFlags()
  if (!flags.reviewEnabled) {
    return res.json({ ok: true, rubrics: [], inherited: false })
  }
  const rubrics = await getComplianceRubricsForUser(userId)
  const userDoc = await User.findOne({ _id: userId }).lean()
  const inherited = !(
    Array.isArray(userDoc?.llmComplianceRubrics) &&
    userDoc.llmComplianceRubrics.length
  )
  res.json({ ok: true, rubrics, inherited })
}

async function saveUserCompliance(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'unauthorized', message: 'Login required' })
  }
  const flags = await getLLMFeatureFlags()
  if (!flags.reviewEnabled) {
    return res
      .status(403)
      .json({
        ok: false,
        error: 'disabled',
        message: 'The compliance review feature is disabled',
      })
  }
  const list = req.body?.rubrics
  const sanitized = sanitizeComplianceRubrics(list)
  if (sanitized === null) {
    return res
      .status(400)
      .json({ ok: false, error: 'bad-request', message: 'Invalid rubrics' })
  }
  const problem = validateComplianceRubrics(Array.isArray(list) ? list : [])
  if (problem) {
    return res
      .status(400)
      .json({ ok: false, error: 'bad-request', message: problem })
  }
  await User.updateOne(
    { _id: userId },
    { $set: { llmComplianceRubrics: sanitized } }
  )
  res.json({ ok: true, rubrics: sanitized })
}

// overleaf-lab (usage meter): the user's own token accounting for /user/llm-settings.
async function userUsageSummary(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return res.status(401).json({ ok: false })
  }
  const days = parseInt(req.query.days, 10)
  const summary = await getUsageSummary({
    userId,
    days: Number.isFinite(days) ? days : 30,
  })
  if (summary) {
    return res.json({ ok: true, ...summary })
  }
  return res.json({ ok: false, error: 'unavailable' })
}

export default {
  isUserSettingsAllowed,
  requireUserSettingsAllowed,
  MAX_PROVIDERS_PER_USER,
  llmSettingsPage, // sync render - must NOT be expressified (no .catch)
  getProvidersJson: expressify(getProvidersJson),
  addProvider: expressify(addProvider),
  updateProvider: expressify(updateProvider),
  deleteProvider: expressify(deleteProvider),
  checkProviderConnection: expressify(checkProviderConnection),
  scanProviderModels: expressify(scanProviderModels),
  userUsageSummary: expressify(userUsageSummary), // overleaf-lab (usage meter)
  // overleaf-lab: user-scoped shared model selection (File → "Select LLM Model")
  getSelectedModel: expressify(getSelectedModel),
  saveSelectedModel: expressify(saveSelectedModel),
  // 翻訳専用設定（翻訳レールの接続先を BYO 行から選ぶ・Phase 2）
  getTranslationSettings: expressify(getTranslationSettings),
  saveTranslationSettings: expressify(saveTranslationSettings),
  // 機能別 AI 選択（チャット/Ask AI/補完/生成/コンパイル修正/準拠レビュー）
  getFeatureModels: expressify(getFeatureModels),
  saveFeatureModels: expressify(saveFeatureModels),
  // overleaf-lab (2026-08-27): user-scoped compliance review rubrics
  getUserCompliance: expressify(getUserCompliance),
  saveUserCompliance: expressify(saveUserCompliance),
}
