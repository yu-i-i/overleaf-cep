import logger from '@overleaf/logger'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { expressify } from '@overleaf/promise-utils'
import OError from '@overleaf/o-error'
import { encryptSecret, decryptSecret } from './LLMCrypto.mjs' // overleaf-lab: at-rest encryption of admin API key
import { createLLMProvider, detectApiType } from './LLMProviderFactory.mjs'
import {
  DEFAULT_ASK_AI_SYSTEM_PROMPT,
  DEFAULT_ERROR_PROMPT,
  DEFAULT_REVIEW_SYSTEM_PROMPT,
  DEFAULT_ASK_AI_ACTION_PROMPTS,
  mergeActionPrompts,
} from './LLMPrompts.mjs' // overleaf-lab: editable prompt defaults + merge helper

// Persist admin LLM settings in the same volume used by Overleaf data
const ADMIN_SETTINGS_PATH = process.env.LLM_ADMIN_SETTINGS_PATH ||
  '/var/lib/overleaf/data/llm-admin-settings.json'

// overleaf-lab: fallback for the review answer budget when the admin has not set one.
// Mirrors LLMComplianceController's REVIEW_MAX_TOKENS default (env override, else
// 12000). Duplicated here on purpose: importing it would make the two controllers
// import each other, since the compliance one already imports this module.
const DEFAULT_REVIEW_MAX_TOKENS =
  Number.parseInt(process.env.LLM_REVIEW_MAX_TOKENS, 10) > 0
    ? Number.parseInt(process.env.LLM_REVIEW_MAX_TOKENS, 10)
    : 12000

function readAdminSettings() {
  try {
    const raw = fs.readFileSync(ADMIN_SETTINGS_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    logger.warn({ err, path: ADMIN_SETTINGS_PATH }, '[LLM] Could not read admin settings file')
    return {}
  }
}

function writeAdminSettings(data) {
  try {
    fs.mkdirSync(path.dirname(ADMIN_SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(ADMIN_SETTINGS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 })
  } catch (err) {
    logger.error({ err, path: ADMIN_SETTINGS_PATH }, '[LLM] Could not write admin settings file')
    throw err
  }
}

// overleaf-lab: the shared LLM backend can be configured either via this admin
// settings JSON file OR via environment variables (LLM_API_URL / LLM_API_KEY /
// LLM_MODEL_NAME). The chat already falls back to env; expose the same fallback
// here so the admin page and the model scan reflect an env-only configuration
// instead of looking empty.
function envModelList() {
  const raw = process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME || ''
  return raw
    .split(',')
    .map(m => m.trim())
    .filter(m => m.length > 0)
}

// Effective settings for display: the JSON value, else the env fallback, plus
// flags telling the UI which values are inherited from the environment. The API
// key value is never returned, only whether one is set.
async function buildDisplaySettings() {
  const settings = readAdminSettings()
  const envModels = envModelList()
  const jsonHasModels =
    Array.isArray(settings.allowedModels) && settings.allowedModels.length > 0
  return {
    systemPrompt: settings.systemPrompt || '',
    llmApiUrl: settings.llmApiUrl || process.env.LLM_API_URL || '',
    llmApiType:
      settings.llmApiType ||
      process.env.LLM_API_TYPE ||
      detectApiType({
        llmApiUrl: settings.llmApiUrl || process.env.LLM_API_URL,
        llmApiKey:
          settings.llmApiKey
            ? decryptSecret(settings.llmApiKey)
            : process.env.LLM_API_KEY,
      }),
    hasLlmApiKey: !!(settings.llmApiKey || process.env.LLM_API_KEY),
    allowedModels: jsonHasModels ? settings.allowedModels : envModels,
    // overleaf-lab: item 8 (PR decision) — the FULL fetched model list; allowedModels
    // is the checked/enabled subset. The UI keeps unchecked models visible so an
    // admin can re-enable them without rescan.
    knownModels:
      Array.isArray(settings.knownModels) && settings.knownModels.length > 0
        ? settings.knownModels
        : jsonHasModels
          ? settings.allowedModels
          : envModels,
    completionModel: settings.completionModel || '',
    llmApiUrlFromEnv: !settings.llmApiUrl && !!process.env.LLM_API_URL,
    llmApiTypeFromEnv: !settings.llmApiType && !!process.env.LLM_API_TYPE,
    hasApiKeyFromEnv: !settings.llmApiKey && !!process.env.LLM_API_KEY,
    allowedModelsFromEnv: !jsonHasModels && envModels.length > 0,
    // overleaf-lab: document compliance review settings
    complianceRubrics: Array.isArray(settings.complianceRubrics) ? settings.complianceRubrics : [],
    reviewModel: settings.reviewModel || '',
    maxContextTokens: settings.maxContextTokens || 32000,
    reviewMaxTokens: settings.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS,
    // overleaf-lab: per-feature enable flags; absent field defaults to true so
    // existing installs keep every feature on.
    chatEnabled: settings.chatEnabled !== false,
    completionEnabled: settings.completionEnabled !== false,
    reviewEnabled: settings.reviewEnabled !== false,
    // overleaf-lab: editable prompt overrides. Show the EFFECTIVE value (the
    // admin override when set, else the shipped default) plus the pristine
    // defaults so the admin page can offer a reset-to-default button.
    askAiSystemPrompt: settings.askAiSystemPrompt || DEFAULT_ASK_AI_SYSTEM_PROMPT,
    errorPrompt: settings.errorPrompt || DEFAULT_ERROR_PROMPT,
    reviewSystemPrompt: settings.reviewSystemPrompt || DEFAULT_REVIEW_SYSTEM_PROMPT,
    askAiActionPrompts: mergeActionPrompts(settings.askAiActionPrompts),
    promptDefaults: {
      askAiSystemPrompt: DEFAULT_ASK_AI_SYSTEM_PROMPT,
      errorPrompt: DEFAULT_ERROR_PROMPT,
      reviewSystemPrompt: DEFAULT_REVIEW_SYSTEM_PROMPT,
      askAiActionPrompts: DEFAULT_ASK_AI_ACTION_PROMPTS,
    },
  }
}

async function adminSettingsPage(req, res) {
  const pugPath = new URL('../../app/views/llm-admin-settings.pug', import.meta.url).pathname
  res.render(pugPath, await buildDisplaySettings())
}

async function getAdminSettings(req, res) {
  res.json(await buildDisplaySettings())
}

const llmSettingsSchema = z.object({
  systemPrompt: z.string().max(4000),

  llmApiUrl: z.string().optional(),
  llmApiType: z.string().optional(),
  llmApiKey: z.string().optional(),
  clearLlmApiKey: z.boolean().optional(),

  allowedModels: z.array(z.string()).optional(),
  // overleaf-lab: item 8 — the full fetched model list (checked subset = allowedModels)
  knownModels: z.array(z.string()).optional(),

  completionModel: z.string().optional(),

  complianceRubrics: z.array(z.unknown()).optional(),

  reviewModel: z.string().optional(),

  maxContextTokens: z.number().optional(),
  reviewMaxTokens: z.number().optional(),

  chatEnabled: z.boolean().optional(),
  completionEnabled: z.boolean().optional(),
  reviewEnabled: z.boolean().optional(),

  // overleaf-lab: editable prompt overrides. Each scalar prompt, when provided,
  // must be a string capped at 8000 chars. An empty string is allowed and means
  // "fall back to default" (buildDisplaySettings/getLLMPrompts use `|| DEFAULT`).
  askAiSystemPrompt: z.string().max(8000).optional(),
  errorPrompt: z.string().max(8000).optional(),
  reviewSystemPrompt: z.string().max(8000).optional(),

  // overleaf-lab: action prompts, when provided, must be a plain (non-array) object.
  askAiActionPrompts: z
    .record(z.string(), z.string())
    .optional(),
})

async function saveAdminSettings(req, res) {
  const safeBody = llmSettingsSchema.safeParse(req.body)
  if (!safeBody.success) {
    const errors = Object.fromEntries(
      safeBody.error.issues.map(issue => [
        issue.path.join('.'),
        issue.message,
      ])
    )
    logger.error( errors, 'Bad admin settings')
// TODO: send all errors to the frontend and show them
    return res.status(400).json({
      error: safeBody.error.issues[0].message,
    })
  }

  const {
    systemPrompt,
    llmApiUrl,
    llmApiType,
    llmApiKey,
    clearLlmApiKey,
    allowedModels,
    knownModels,
    completionModel,
    complianceRubrics,
    reviewModel,
    maxContextTokens,
    reviewMaxTokens,
    chatEnabled,
    completionEnabled,
    reviewEnabled,
    // overleaf-lab: editable prompt overrides.
    askAiSystemPrompt,
    errorPrompt,
    reviewSystemPrompt,
    askAiActionPrompts,
  } = safeBody.data

  const existing = readAdminSettings()

  // overleaf-lab: sanitize each rubric and cap the count. Entries without an id or
  // name are dropped; text fields are length-capped. When not provided, keep the
  // existing rubrics untouched.
  let sanitizedRubrics
  if (Array.isArray(complianceRubrics)) {
    sanitizedRubrics = complianceRubrics
      .map(r => ({
        id: String((r && r.id) || ''),
        name: String((r && r.name) || '').slice(0, 200),
        guidelines: String((r && r.guidelines) || '').slice(0, 20000),
        // overleaf-lab: per-rubric mechanical scans ("Label :: regex" per
        // line); policy lives with the rubric it verifies, never in code.
        scanPatterns: String((r && r.scanPatterns) || '').slice(0, 4000),
      }))
      .filter(r => r.id && r.name)
      .slice(0, 50)
  } else {
    sanitizedRubrics = Array.isArray(existing.complianceRubrics) ? existing.complianceRubrics : []
  }

  // overleaf-lab: clamp the context window to a sane range; keep existing (or the
  // 32000 default) when not provided.
  let sanitizedMaxContextTokens
  if (maxContextTokens !== undefined) {
    const parsed = parseInt(maxContextTokens, 10)
    sanitizedMaxContextTokens = Number.isNaN(parsed)
      ? existing.maxContextTokens || 32000
      : Math.min(1000000, Math.max(2000, parsed))
  } else {
    sanitizedMaxContextTokens = existing.maxContextTokens || 32000
  }

  // overleaf-lab: clamp the review answer budget. This is the model's max_tokens for
  // the report AND the room reserved for it in the context check, so it is bounded
  // well below any real context window.
  let sanitizedReviewMaxTokens
  if (reviewMaxTokens !== undefined) {
    const parsed = parseInt(reviewMaxTokens, 10)
    sanitizedReviewMaxTokens = Number.isNaN(parsed)
      ? existing.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS
      : Math.min(128000, Math.max(500, parsed))
  } else {
    sanitizedReviewMaxTokens = existing.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS
  }

  // overleaf-lab: validate each rubric's scan patterns ("Label :: regex" per line)
  // so the admin learns about a broken regex at save time, not from a silently
  // hint-less review. The reviewer side skips invalid lines anyway (defense in
  // depth for settings written by other means).
  if (Array.isArray(complianceRubrics)) {
    for (const r of complianceRubrics) {
      const patternsText = r && typeof r.scanPatterns === 'string' ? r.scanPatterns : ''
      if (patternsText.length > 4000) {
        return res.status(400).json({
          error: `Scan patterns of rubric "${(r && r.name) || '?'}" must be 4000 characters or fewer`,
        })
      }
      for (const rawLine of patternsText.split('\n')) {
        const line = rawLine.trim()
        if (!line) {
          continue
        }
        const sep = line.indexOf('::')
        const body = (sep === -1 ? line : line.slice(sep + 2)).trim()
        if (!body) {
          continue
        }
        try {
          // eslint-disable-next-line no-new
          new RegExp(body, 'i')
        } catch (err) {
          return res.status(400).json({
            error: `Invalid scan pattern regex in rubric "${(r && r.name) || '?'}": ${body}`,
          })
        }
      }
    }
  }

  // overleaf-lab: sanitize the action prompt overrides. When provided, keep only
  // known keys with string values, each capped at 4000 chars. When not provided,
  // keep the existing object untouched.
  let sanitizedActionPrompts
  if (askAiActionPrompts !== undefined) {
    sanitizedActionPrompts = {}
    for (const key of Object.keys(DEFAULT_ASK_AI_ACTION_PROMPTS)) {
      const val = askAiActionPrompts[key]
      if (typeof val === 'string') {
        sanitizedActionPrompts[key] = val.slice(0, 4000)
      }
    }
  } else {
    sanitizedActionPrompts =
      existing.askAiActionPrompts &&
      typeof existing.askAiActionPrompts === 'object' &&
      !Array.isArray(existing.askAiActionPrompts)
        ? existing.askAiActionPrompts
        : {}
  }

  const updatedSettings = {
    ...existing,
    systemPrompt,
    llmApiUrl: typeof llmApiUrl === 'string' ? llmApiUrl : (existing.llmApiUrl || ''),
    llmApiType: typeof llmApiType === 'string' ? llmApiType : (existing.llmApiType || ''),
    allowedModels: Array.isArray(allowedModels) ? allowedModels : existing.allowedModels || [],
    knownModels: Array.isArray(knownModels)
      ? knownModels
      : Array.isArray(existing.knownModels)
        ? existing.knownModels
        : Array.isArray(existing.allowedModels)
          ? existing.allowedModels
          : [],
    completionModel: typeof completionModel === 'string' ? completionModel : (existing.completionModel || ''),
    complianceRubrics: sanitizedRubrics,
    reviewModel: typeof reviewModel === 'string' ? reviewModel : (existing.reviewModel || ''),
    maxContextTokens: sanitizedMaxContextTokens,
    reviewMaxTokens: sanitizedReviewMaxTokens,
    // overleaf-lab: omitted flag keeps the existing value (default true).
    chatEnabled: typeof chatEnabled === 'boolean' ? chatEnabled : (existing.chatEnabled !== false),
    completionEnabled: typeof completionEnabled === 'boolean' ? completionEnabled : (existing.completionEnabled !== false),
    reviewEnabled: typeof reviewEnabled === 'boolean' ? reviewEnabled : (existing.reviewEnabled !== false),
    // overleaf-lab: editable prompt overrides. An empty string is stored as-is
    // and later falls back to the default via `|| DEFAULT`.
    askAiSystemPrompt: typeof askAiSystemPrompt === 'string' ? askAiSystemPrompt : (existing.askAiSystemPrompt || ''),
    errorPrompt: typeof errorPrompt === 'string' ? errorPrompt : (existing.errorPrompt || ''),
    reviewSystemPrompt: typeof reviewSystemPrompt === 'string' ? reviewSystemPrompt : (existing.reviewSystemPrompt || ''),
    askAiActionPrompts: sanitizedActionPrompts,
  }

  if (clearLlmApiKey) {
    updatedSettings.llmApiKey = '' // overleaf-lab: explicit "remove stored key" from the admin UI
  } else if (typeof llmApiKey === 'string' && llmApiKey.trim().length > 0) {
    updatedSettings.llmApiKey = encryptSecret(llmApiKey.trim()) // overleaf-lab: encrypt admin key at rest
  }

  await writeAdminSettings(updatedSettings)
  logger.info({
    length: systemPrompt.length,
    llmApiUrl: !!updatedSettings.llmApiUrl,
    llmApiType: !!updatedSettings.llmApiType,
    hasLlmApiKey: !!updatedSettings.llmApiKey,
    allowedModels: updatedSettings.allowedModels?.length || 0,
    knownModels: updatedSettings.knownModels?.length || 0,
  }, '[LLM] Admin settings updated')

  res.json({ success: true })
}

// Exported so LLMChatController can prepend the admin system prompt
export async function getSystemPrompt() {
  const settings = readAdminSettings()
  return settings.systemPrompt || null
}

export async function getAdminLLMSettings() {
  const settings = readAdminSettings()
  // overleaf-lab: fall back to env so the model scan / connection-check and the
  // chat share the same effective config (mirrors buildDisplaySettings above).
  const jsonHasModels =
      Array.isArray(settings.allowedModels) && settings.allowedModels.length > 0
  // overleaf-lab: the stored admin key is encrypted at rest; decrypt before use.
  // decryptSecret returns legacy plaintext (no enc:v1: prefix) unchanged.
  const jsonKey = settings.llmApiKey ? decryptSecret(settings.llmApiKey) : ''
  return {
    llmApiUrl: settings.llmApiUrl || process.env.LLM_API_URL || null,
    llmApiType:
      settings.llmApiType ||
      process.env.LLM_API_TYPE ||
      detectApiType({
        llmApiUrl: settings.llmApiUrl || process.env.LLM_API_URL,
        llmApiKey: jsonKey || process.env.LLM_API_KEY,
      }),
    llmApiKey: jsonKey || process.env.LLM_API_KEY || null,
    allowedModels: jsonHasModels ? settings.allowedModels : envModelList(),
    completionModel: settings.completionModel || '',
    // overleaf-lab: document compliance review settings
    reviewModel: settings.reviewModel || '',
    maxContextTokens: settings.maxContextTokens || 32000,
    reviewMaxTokens: settings.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS,
    // overleaf-lab: per-feature enable flags (absent field defaults to true).
    chatEnabled: settings.chatEnabled !== false,
    completionEnabled: settings.completionEnabled !== false,
    reviewEnabled: settings.reviewEnabled !== false,
  }
}

// overleaf-lab: per-feature enable flags for the chat, inline completion, and
// compliance review features. An absent field defaults to true so existing
// installs keep every feature on. Used for backend enforcement across the
// project-scoped controllers and the user settings page.
export async function getLLMFeatureFlags() {
  const s = readAdminSettings()
  return {
    chatEnabled: s.chatEnabled !== false,
    completionEnabled: s.completionEnabled !== false,
    reviewEnabled: s.reviewEnabled !== false,
  }
}

// overleaf-lab: exposed so the compliance controller can load the configured
// rubrics (readAdminSettings already handles the missing-file case).
export async function getComplianceRubrics() {
  const settings = readAdminSettings()
  return Array.isArray(settings.complianceRubrics) ? settings.complianceRubrics : []
}

// overleaf-lab: resolve the EFFECTIVE editable prompts (admin override when set,
// else the shipped default). Consumed by the compliance reviewer and the
// project-scoped GET /llm/prompts endpoint so the frontend and backend agree.
export async function getLLMPrompts() {
  const s = readAdminSettings()
  return {
    askAiSystemPrompt: s.askAiSystemPrompt || DEFAULT_ASK_AI_SYSTEM_PROMPT,
    errorPrompt: s.errorPrompt || DEFAULT_ERROR_PROMPT,
    reviewSystemPrompt: s.reviewSystemPrompt || DEFAULT_REVIEW_SYSTEM_PROMPT,
    askAiActionPrompts: mergeActionPrompts(s.askAiActionPrompts),
  }
}

// overleaf-lab: hard cap for an interactive provider call (model list / token
// count) so a wedged backend cannot hang the settings UI. The provider's own
// fetch timeout still applies below this.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function checkAdminLLMConnection(req, res) {
  const { apiUrl, apiKey, apiType } = req.body
  const adminSettings = await getAdminLLMSettings()
  const llmApiUrl = apiUrl || adminSettings.llmApiUrl
  const llmApiKey = apiKey || adminSettings.llmApiKey
  const llmApiType = apiType || adminSettings.llmApiType || detectApiType({ llmApiUrl, llmApiKey })

  // overleaf-lab: PR decision (item 7) — "testing the connection" IS a
  // successful model-list fetch: it proves reachability, auth, and that the
  // backend serves at least one model, in ONE round trip. The first configured
  // model (if any) must be in the list, which catches typos/stopped models.
  const testModel =
    adminSettings.allowedModels[0] ||
    (process.env.LLM_MODEL_NAME || '').split(',')[0].trim()

  if (!llmApiUrl || !llmApiType) {
    return res.status(400).json({
      success: false,
      error: 'LLM API URL and type is required',
    })
  }

  try {
    const provider = createLLMProvider({ llmApiUrl, llmApiKey, llmApiType })
    const data = await withTimeout(provider.listModels(), 60000, 'Model list fetch')

    const ids = Array.isArray(data?.data)
      ? data.data.map(entry => String(entry.id))
      : []

    if (testModel && !ids.includes(testModel)) {
      logger.warn({ testModel, ids: ids.length }, '[LLM] Admin check: configured model not in backend list')
      return res.status(404).json({
        success: false,
        error: `Model "${testModel}" is not available on this backend`,
        status: 404,
        models: ids,
      })
    }

    res.json({ success: true, message: 'Connection successful', models: ids })
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error({ err }, '[LLM] Admin connection check failed')
    res.status(errStatus).json({
      success: false,
      error: 'LLM connection failed',
      status: errStatus,
      details: info?.error?.message || err.message,
    })
  }
}

async function scanAdminModels(req, res) {
  // overleaf-lab: credentials come from the POST body, never the URL query
  // string (keys in query strings leak into access logs).
  const { apiUrl, apiKey, apiType } = req.body
  const adminSettings = await getAdminLLMSettings()
  const llmApiUrl = apiUrl || adminSettings.llmApiUrl
  const llmApiKey = apiKey || adminSettings.llmApiKey
  const llmApiType = apiType || adminSettings.llmApiType || detectApiType({ llmApiUrl, llmApiKey })

  if (!llmApiUrl || !llmApiType) {
    return res.status(400).json({
      success: false,
      error: 'Admin LLM API URL and type must be configured first',
    })
  }

  try {
    const provider = createLLMProvider({ llmApiUrl, llmApiKey, llmApiType })
    const result = await provider.listModels()

    const ids = Array.isArray(result?.data)
      ? result.data.map(entry => String(entry.id))
      : []

    res.json({ success: true, models: ids })

  } catch (error) {
    const info = OError.getFullInfo(error)
    const errStatus = info?.status || 500
    logger.error({ error }, '[LLM] Admin model scan failed')
    res.status(errStatus).json({
      success: false,
      error: 'Model scan failed',
      status: errStatus,
      details: info?.error?.message || error.message,
    })
  }
}

export default {
  adminSettingsPage: expressify(adminSettingsPage),
  getAdminSettings: expressify(getAdminSettings),
  saveAdminSettings: expressify(saveAdminSettings),
  checkAdminLLMConnection: expressify(checkAdminLLMConnection),
  scanAdminModels: expressify(scanAdminModels),
}
