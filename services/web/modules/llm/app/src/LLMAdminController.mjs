import logger from '@overleaf/logger'
import { promises as fs } from 'fs'
import path from 'path'
import { expressify } from '@overleaf/promise-utils'

// Persist admin LLM settings in the same volume used by Overleaf data
const ADMIN_SETTINGS_PATH = process.env.LLM_ADMIN_SETTINGS_PATH ||
    '/var/lib/overleaf/data/llm-admin-settings.json'

async function readAdminSettings() {
    try {
        const raw = await fs.readFile(ADMIN_SETTINGS_PATH, 'utf8')
        return JSON.parse(raw)
    } catch (err) {
        if (err.code === 'ENOENT') return {}
        logger.warn({ err, path: ADMIN_SETTINGS_PATH }, '[LLM] Could not read admin settings file')
        return {}
    }
}

async function writeAdminSettings(data) {
    try {
        await fs.mkdir(path.dirname(ADMIN_SETTINGS_PATH), { recursive: true })
        await fs.writeFile(ADMIN_SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
        logger.error({ err, path: ADMIN_SETTINGS_PATH }, '[LLM] Could not write admin settings file')
        throw err
    }
}

async function adminSettingsPage(req, res) {
    const settings = await readAdminSettings()
    const pugPath = new URL('../../app/views/llm-admin-settings.pug', import.meta.url).pathname
    res.render(pugPath, {
        systemPrompt: settings.systemPrompt || '',
        llmApiUrl: settings.llmApiUrl || '',
        hasLlmApiKey: !!settings.llmApiKey,
        allowedModels: settings.allowedModels || [],
    })
}

async function getAdminSettings(req, res) {
    const settings = await readAdminSettings()
    res.json({
        systemPrompt: settings.systemPrompt || '',
        llmApiUrl: settings.llmApiUrl || '',
        hasLlmApiKey: !!settings.llmApiKey,
        allowedModels: settings.allowedModels || [],
    })
}

async function saveAdminSettings(req, res) {
    const { systemPrompt, llmApiUrl, llmApiKey, allowedModels } = req.body

    if (typeof systemPrompt !== 'string') {
        return res.status(400).json({ error: 'systemPrompt must be a string' })
    }
    if (systemPrompt.length > 4000) {
        return res.status(400).json({ error: 'systemPrompt must be 4000 characters or fewer' })
    }

    if (llmApiUrl && typeof llmApiUrl !== 'string') {
        return res.status(400).json({ error: 'llmApiUrl must be a string' })
    }
    if (llmApiKey && typeof llmApiKey !== 'string') {
        return res.status(400).json({ error: 'llmApiKey must be a string' })
    }
    if (allowedModels && !Array.isArray(allowedModels)) {
        return res.status(400).json({ error: 'allowedModels must be an array' })
    }

    const existing = await readAdminSettings()
    const updatedSettings = {
        ...existing,
        systemPrompt,
        llmApiUrl: typeof llmApiUrl === 'string' ? llmApiUrl : (existing.llmApiUrl || ''),
        allowedModels: Array.isArray(allowedModels) ? allowedModels : existing.allowedModels || [],
    }

    if (typeof llmApiKey === 'string' && llmApiKey.trim().length > 0) {
        updatedSettings.llmApiKey = llmApiKey.trim()
    }

    await writeAdminSettings(updatedSettings)
    logger.info({
        length: systemPrompt.length,
        llmApiUrl: !!updatedSettings.llmApiUrl,
        hasLlmApiKey: !!updatedSettings.llmApiKey,
        allowedModels: updatedSettings.allowedModels?.length || 0,
    }, '[LLM] Admin settings updated')

    res.json({ success: true })
}

// Exported so LLMChatController can prepend the admin system prompt
export async function getSystemPrompt() {
    const settings = await readAdminSettings()
    return settings.systemPrompt || null
}

export async function getAdminLLMSettings() {
    const settings = await readAdminSettings()
    return {
        llmApiUrl: settings.llmApiUrl || null,
        llmApiKey: settings.llmApiKey || null,
        allowedModels: Array.isArray(settings.allowedModels)
            ? settings.allowedModels
            : [],
    }
}

async function checkAdminLLMConnection(req, res) {
    const { apiUrl, apiKey } = req.body
    const adminSettings = await getAdminLLMSettings()
    const effectiveUrl = apiUrl || adminSettings.llmApiUrl
    const effectiveKey = apiKey || adminSettings.llmApiKey

    if (!effectiveUrl || !effectiveKey) {
        return res.status(400).json({
            success: false,
            error: 'LLM API URL and API key are required',
        })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
        const response = await fetch(`${effectiveUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${effectiveKey}`,
            },
            body: JSON.stringify({
                model: 'qwen3-32b',
                messages: [{ role: 'user', content: 'Test connection' }],
                max_tokens: 1,
            }),
            signal: controller.signal,
        })

        clearTimeout(timeout)

        if (!response.ok) {
            const body = await response.text()
            return res.status(400).json({
                success: false,
                error: 'LLM connection failed',
                status: response.status,
                details: body,
            })
        }

        res.json({ success: true, message: 'Connection successful' })
    } catch (err) {
        clearTimeout(timeout)
        if (err.name === 'AbortError') {
            return res.status(504).json({
                success: false,
                error: 'Connection timeout',
            })
        }
        logger.error({ err }, '[LLM] Admin connection check failed')
        res.status(500).json({ success: false, error: 'Connection attempt failed' })
    }
}

async function scanAdminModels(req, res) {
    const { apiUrl, apiKey } = req.query
    const adminSettings = await getAdminLLMSettings()
    const llmApiUrl = apiUrl || adminSettings.llmApiUrl
    const llmApiKey = apiKey || adminSettings.llmApiKey

    if (!llmApiUrl || !llmApiKey) {
        return res.status(400).json({
            success: false,
            error: 'Admin LLM API URL and API key must be configured first',
        })
    }

    try {
        const response = await fetch(`${llmApiUrl}/models`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${llmApiKey}`,
            },
        })

        if (!response.ok) {
            const body = await response.text()
            return res.status(400).json({
                success: false,
                error: 'Failed to fetch models',
                status: response.status,
                details: body,
            })
        }

        const data = await response.json()
        const ids = Array.isArray(data?.data)
            ? data.data.map(entry => String(entry.id))
            : []

        res.json({ success: true, models: ids })
    } catch (error) {
        logger.error({ err: error }, '[LLM] Admin model scan failed')
        res.status(500).json({ success: false, error: 'Model scan failed' })
    }
}

export default {
    adminSettingsPage: expressify(adminSettingsPage),
    getAdminSettings: expressify(getAdminSettings),
    saveAdminSettings: expressify(saveAdminSettings),
    checkAdminLLMConnection: expressify(checkAdminLLMConnection),
    scanAdminModels: expressify(scanAdminModels),
}
