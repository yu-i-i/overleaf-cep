import logger from '@overleaf/logger'
import { fileURLToPath } from 'node:url'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { expressify } from '@overleaf/promise-utils'
import { encryptSecret, decryptSecret } from './LLMCrypto.mjs' // overleaf-lab: at-rest encryption of user API keys
import { getLLMFeatureFlags } from './LLMAdminController.mjs' // overleaf-lab: per-feature enable flags
import { createLLMProvider, detectApiType } from './LLMProviderFactory.mjs' // overleaf-lab: provider-agnostic check/scan
import OError from '@overleaf/o-error'

// overleaf-lab: the personal LLM settings page. Kept as its own route: each
// module frontend is a separate webpack entry point (modules/*/frontend), and
// importing module React code into the core bundle risks dual React instances,
// so the Account Settings page links here instead of embedding the component.
const llmSettingsPugPath = fileURLToPath(
    new URL('../../app/views/llm-settings.pug', import.meta.url)
)

async function llmSettingsPage(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)

    logger.debug({ userId, pugPath: llmSettingsPugPath }, '[LLM] llmSettingsPage: rendering')

    // overleaf-lab: when both chat and inline completion are disabled by the
    // admin, the personal-settings page has nothing to configure, so send the
    // user home.
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled && !flags.completionEnabled) {
        return res.redirect('/')
    }

    let user = {}
    try {
        user = await User.findById(
            userId,
            'useOwnLLMSettings llmModelName llmApiUrl llmApiKey llmCompletionModel'
        )
    } catch (err) {
        logger.warn({ userId, err }, '[LLM] Error loading user for settings page')
    }

    const llmSettings = {
        useOwnSettings: user?.useOwnLLMSettings || false,
        modelName: user?.llmModelName || '',
        apiUrl: user?.llmApiUrl || '',
        hasApiKey: !!(user?.llmApiKey),
        completionModel: user?.llmCompletionModel || '',
    }

    logger.debug(
        { userId, useOwnSettings: llmSettings.useOwnSettings, hasApiKey: llmSettings.hasApiKey },
        '[LLM] llmSettingsPage: user settings loaded'
    )

    res.render(llmSettingsPugPath, {
        user: { llmSettings },
        featureFlags: { chatEnabled: flags.chatEnabled, completionEnabled: flags.completionEnabled },
    })
}

// overleaf-lab: current stored LLM settings (mirrors what the old standalone
// page rendered into its metas). The key value itself is never returned, only
// its presence.
async function getLLMSettingsJson(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)

    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled && !flags.completionEnabled) {
        return res.status(404).json({ error: 'feature_disabled' })
    }

    let user = {}
    try {
        user = await User.findById(
            userId,
            'useOwnLLMSettings llmModelName llmApiUrl llmApiKey llmCompletionModel'
        )
    } catch (err) {
        logger.warn({ userId, err }, '[LLM] Error loading user for settings json')
    }

    res.json({
        useOwnSettings: user?.useOwnLLMSettings || false,
        modelName: user?.llmModelName || '',
        apiUrl: user?.llmApiUrl || '',
        hasApiKey: !!(user?.llmApiKey),
        completionModel: user?.llmCompletionModel || '',
    })
}

// overleaf-lab: hard cap for interactive provider calls so a wedged backend
// cannot hang the settings UI. The provider's own fetch timeout applies below.
function withTimeout(promise, ms, label) {
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}


async function checkLLMConnection(req, res) {
    const { apiUrl, apiKey: providedApiKey, modelName } = req.body
    const userId = SessionManager.getLoggedInUserId(req.session)

    logger.debug(
        { userId, apiUrl, modelName, hasProvidedKey: !!providedApiKey },
        '[LLM] checkLLMConnection: request received'
    )

    // If no API key provided, fall back to stored key
    let apiKey = providedApiKey
    if (!apiKey) {
        try {
            const user = await User.findById(userId, 'llmApiKey')
            if (user && user.llmApiKey) {
                apiKey = decryptSecret(user.llmApiKey) // overleaf-lab: decrypt stored key at rest
                logger.debug({ userId }, '[LLM] checkLLMConnection: using stored API key')
            }
        } catch (err) {
            logger.warn({ err }, '[LLM] Could not fetch stored API key')
        }
    }

    // overleaf-lab: the key is optional (a local llama.cpp server has no auth);
    // only the URL is required (item 7: connection check = model-list fetch).
    if (!apiUrl) {
        return res.status(400).json({ error: 'Missing required parameters' })
    }

    // overleaf-lab: PR decision (item 7) — testing the connection IS a successful
    // model-list fetch (reachability + auth + served models in one round trip).
    // Optionally the requested model must be in the list, which catches typos and
    // stopped models. The returned model list lets the UI refresh in the same call.
    // provider-agnostic (F4): the provider owns endpoint path and auth header.
    const apiType = detectApiType({ llmApiUrl: apiUrl, llmApiKey: apiKey })
    const provider = createLLMProvider({
        llmApiUrl: apiUrl,
        llmApiKey: apiKey,
        llmApiType: apiType,
    })
    const startTime = Date.now()

    try {
        const data = await withTimeout(provider.listModels(), 60000, 'Model list fetch')
        const ids = Array.isArray(data?.data)
            ? data.data.map(entry => String(entry.id))
            : []

        const duration = Date.now() - startTime

        if (modelName && !ids.includes(modelName)) {
            logger.warn(
                { userId, apiUrl, apiType, modelName, ids: ids.length },
                '[LLM] checkLLMConnection: model not in backend list'
            )
            return res.status(404).json({
                success: false,
                error: `Model "${modelName}" is not available on this backend`,
                details: `Available: ${ids.length} model(s)`,
                models: ids,
                status: 404,
            })
        }

        logger.debug(
            { userId, apiUrl, apiType, duration: `${duration}ms`, modelCount: ids.length },
            '[LLM] checkLLMConnection: LLM API responded'
        )

        res.json({
            success: true,
            message: 'LLM connection successful',
            duration: `${duration}ms`,
            models: ids,
        })
    } catch (error) {
        const info = OError.getFullInfo(error)
        const errStatus = info?.status || 500

        logger.warn({ userId, apiUrl, apiType, err: error }, '[LLM] checkLLMConnection: failed')

        return res.status(errStatus).json({
            success: false,
            error: 'Failed to test LLM connection',
            details: info?.error?.message || error.message,
            status: errStatus,
        })
    }
}

// overleaf-lab: scan the user's own LLM provider for available model ids.
// Mirrors LLMAdminController.scanAdminModels but resolves credentials from the
// request body, falling back to the user's stored key/URL (like checkLLMConnection).
async function scanUserModels(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { apiUrl: providedApiUrl, apiKey: providedApiKey } = req.body

    logger.debug(
        { userId, apiUrl: providedApiUrl, hasProvidedKey: !!providedApiKey },
        '[LLM] scanUserModels: request received'
    )

    let apiKey = providedApiKey
    let apiUrl = providedApiUrl
    // Fall back to stored key/URL when either is omitted
    if (!apiKey || !apiUrl) {
        try {
            const user = await User.findById(userId, 'llmApiKey llmApiUrl')
            if (user) {
                if (!apiKey && user.llmApiKey) {
                    apiKey = decryptSecret(user.llmApiKey) // overleaf-lab: decrypt stored key at rest
                }
                if (!apiUrl && user.llmApiUrl) {
                    apiUrl = user.llmApiUrl
                }
            }
        } catch (err) {
            logger.warn({ userId, err }, '[LLM] Could not fetch stored settings for model scan')
        }
    }

    // overleaf-lab: only the URL is required. A local llama.cpp server has no
    // auth, so an empty key is valid; send Authorization only when a key exists.
    if (!apiUrl) {
        return res.status(400).json({
            success: false,
            error: 'API URL is required',
        })
    }

    // overleaf-lab: provider-agnostic (F4) — the provider owns the endpoint
    // path and auth header, so Anthropic (/v1/models) and OpenAI (/models)
    // both work.
    const apiType = detectApiType({ llmApiUrl: apiUrl, llmApiKey: apiKey })
    const provider = createLLMProvider({
        llmApiUrl: apiUrl,
        llmApiKey: apiKey,
        llmApiType: apiType,
    })

    try {
        const data = await provider.listModels()
        const ids = Array.isArray(data?.data)
            ? data.data.map(entry => String(entry.id)).sort()
            : []

        res.json({ success: true, models: ids })
    } catch (error) {
        const info = OError.getFullInfo(error)
        const errStatus = info?.status || 500

        logger.error({ userId, apiUrl, apiType, err: error }, '[LLM] User model scan failed')
        res.status(errStatus).json({
            success: false,
            error: 'Model scan failed',
            details: info?.error?.message || error.message,
            status: errStatus,
        })
    }
}

async function saveLLMSettings(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { useOwnLLMSettings, llmApiKey, llmModelName, llmApiUrl, llmCompletionModel, clearLlmApiKey } = req.body

    logger.debug(
        {
            userId,
            useOwnLLMSettings,
            llmModelName,
            llmApiUrl,
            hasApiKey: !!llmApiKey,
        },
        '[LLM] saveLLMSettings: request received'
    )

    try {
        if (useOwnLLMSettings) {
            // overleaf-lab: the API key is optional (a local llama.cpp server has no
            // auth); only the URL and model name are required. When a key IS provided
            // it is still encrypted and stored below.
            if (!llmApiUrl || !llmModelName) {
                return res.status(400).json({
                    success: false,
                    error:
                        'API URL and Model Name are required when enabling custom LLM settings',
                })
            }
        }

        const updateData = {
            useOwnLLMSettings: Boolean(useOwnLLMSettings),
            llmModelName: llmModelName || '',
            llmApiUrl: llmApiUrl || '',
            // overleaf-lab: per-user inline-completion model; only meaningful with own settings
            llmCompletionModel: (useOwnLLMSettings && llmCompletionModel) ? llmCompletionModel : '',
        }

        // overleaf-lab: explicit "remove stored key" wins; otherwise only a
        // non-empty key replaces the stored one (an omitted key is left as-is).
        if (clearLlmApiKey) {
            updateData.llmApiKey = ''
        } else if (llmApiKey && llmApiKey.trim() !== '') {
            updateData.llmApiKey = encryptSecret(llmApiKey) // overleaf-lab: encrypt user key at rest
        }

        await User.updateOne({ _id: userId }, { $set: updateData })

        logger.debug({ userId, useOwnLLMSettings }, '[LLM] saveLLMSettings: saved successfully')

        res.json({
            success: true,
            message: 'LLM settings saved successfully',
        })
    } catch (error) {
        logger.error(
            { userId, err: error },
            '[LLM] Error saving settings'
        )

        res.status(500).json({
            success: false,
            error: 'Failed to save LLM settings',
        })
    }
}

export default {
    llmSettingsPage: expressify(llmSettingsPage),
    getLLMSettingsJson: expressify(getLLMSettingsJson),
    checkLLMConnection: expressify(checkLLMConnection),
    scanUserModels: expressify(scanUserModels),
    saveLLMSettings: expressify(saveLLMSettings),
}
