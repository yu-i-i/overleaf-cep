import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import OError from '@overleaf/o-error'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs' // overleaf-lab: read project docs for error source context
import Settings from '@overleaf/settings'
import { getSystemPrompt, getAdminLLMSettings, getLLMFeatureFlags, getLLMPrompts } from './LLMAdminController.mjs'
import { decryptSecret } from './LLMCrypto.mjs' // overleaf-lab: decrypt user API keys stored at rest
import { createLLMProvider } from './LLMProviderFactory.mjs'
// Parse available models from admin settings or environment variable
async function getAvailableModels() {
    if (Settings.llm && !Settings.llm.enabled) {
        logger.debug({ llmEnabled: Settings.llm.enabled }, '[LLM] getAvailableModels: LLM disabled')
        return []
    }

    const adminSettings = await getAdminLLMSettings()
    let modelsList = Array.isArray(adminSettings.allowedModels)
        ? adminSettings.allowedModels.filter(m => typeof m === 'string' && m.trim().length > 0)
        : []

    if (modelsList.length === 0) {
        const modelsEnv = process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME
        logger.debug(
            {
                LLM_AVAILABLE_MODELS: process.env.LLM_AVAILABLE_MODELS,
                LLM_MODEL_NAME: process.env.LLM_MODEL_NAME,
                resolved: modelsEnv,
            },
            '[LLM] getAvailableModels: reading env'
        )

        if (modelsEnv) {
            modelsList = modelsEnv
                .split(',')
                .map(m => m.trim())
                .filter(m => m.length > 0)
        }
    }

    if (modelsList.length === 0) {
        return []
    }

    const result = modelsList.map((id, index) => ({
        id,
        name: id.replace(/-/g, ' ').toUpperCase(),
        isDefault: index === 0,
    }))

    logger.debug({ count: result.length, models: result.map(m => m.id) }, '[LLM] getAvailableModels: parsed models')
    return result
}

async function getModels(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const projectId = req.params.Project_id

    logger.debug(
        { projectId, userId, llmSettings: Settings.llm },
        '[LLM] getModels: request received'
    )

    try {
        if (Settings.llm && !Settings.llm.enabled) {
            logger.debug({}, '[LLM] getModels: LLM disabled, returning empty')
            return res.json({ models: [] })
        }

        // overleaf-lab: chat feature disabled by admin -> no models to select.
        const flags = await getLLMFeatureFlags()
        if (!flags.chatEnabled) {
            return res.json({ models: [] })
        }

        const models = []

        // 1. Add server-wide models from admin settings/env
        const serverModels = await getAvailableModels()
        models.push(...serverModels)

        // 2. Add user's personal LLM model if configured and activated
        if (userId && Settings.llm && Settings.llm.allowUserSettings) {
            try {
                const user = await User.findById(
                    userId,
                    'useOwnLLMSettings llmModelName llmApiUrl llmApiKey'
                )

                if (
                    user &&
                    user.useOwnLLMSettings &&
                    user.llmModelName &&
                    user.llmApiUrl
                ) {
                    // overleaf-lab: llmModelName may be a comma-separated list of
                    // personal chat models; expose one selectable entry per id.
                    const personalModelIds = user.llmModelName
                        .split(',')
                        .map(id => id.trim())
                        .filter(id => id.length > 0)
                    for (const modelId of personalModelIds) {
                        models.push({
                            id: `personal-${modelId}`,
                            name: `${modelId} (🔒 Personal)`,
                            isDefault: false,
                            isPersonal: true,
                            label: 'Private',
                        })
                    }
                }
            } catch (error) {
                logger.warn(
                    { userId, projectId, err: error },
                    '[LLM] Error fetching user LLM settings'
                )
            }
        }

        logger.debug(
            { count: models.length, modelIds: models.map(m => m.id) },
            '[LLM] getModels: returning models'
        )
        res.json({ models })
    } catch (error) {
        logger.error(
            { userId, projectId, err: error },
            '[LLM] Error fetching available models'
        )
        res.status(500).json({
            success: false,
            error: 'Failed to fetch available models',
        })
    }
}

async function chat(req, res) {
    const { messages, model } = req.body
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    logger.debug(
        {
            projectId,
            userId,
            model,
            messageCount: Array.isArray(messages) ? messages.length : 'invalid',
            isPersonalModel: model?.startsWith('personal-'),
        },
        '[LLM] chat: request received'
    )

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Invalid messages format' })
    }

    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ error: 'LLM service is disabled' })
    }

    // overleaf-lab: chat feature disabled by admin. Enforced for everyone, including
    // users with personal API keys, before any personal-settings resolution.
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.status(403).json({ error: 'feature_disabled', message: 'The chat feature is disabled' })
    }

    const isPersonalModel = model && model.startsWith('personal-')
    // overleaf-lab: when the request carries NO model (the selection toolbar /
    // "Ask AI" sends only messages), honor the user's personal LLM settings if they
    // have them, so those features use the user's own key/model just like the chat
    // does. Falls back to the shared backend when no personal settings exist.
    const tryPersonalNoModel =
        !model && userId && Settings.llm && Settings.llm.allowUserSettings

    const adminLlmSettings = await getAdminLLMSettings()
    let llmApiUrl = adminLlmSettings.llmApiUrl || process.env.LLM_API_URL
    let llmApiKey = adminLlmSettings.llmApiKey || process.env.LLM_API_KEY
    let personalModelName = null

    if ((isPersonalModel || tryPersonalNoModel) && userId) {
        try {
            const user = await User.findById(
                userId,
                'useOwnLLMSettings llmApiUrl llmApiKey llmModelName'
            )
            if (
                user &&
                user.useOwnLLMSettings &&
                user.llmApiUrl &&
                (isPersonalModel || user.llmModelName)
            ) {
                llmApiUrl = user.llmApiUrl
                llmApiKey = user.llmApiKey ? decryptSecret(user.llmApiKey) : '' // overleaf-lab: decrypt stored key at rest (empty when keyless)
                personalModelName = isPersonalModel
                    ? model.substring('personal-'.length)
                    : user.llmModelName.split(',')[0].trim() // overleaf-lab: no model sent -> use the user's first (default) model
            } else if (isPersonalModel) {
                return res.status(400).json({
                    error:
                        'Your LLM settings are incomplete. Please configure API URL, API Key, and Model Name in your account settings.',
                })
            }
            // A no-model request with incomplete personal settings falls through to
            // the shared backend checked below.
        } catch (error) {
            if (isPersonalModel) {
                return res.status(500).json({
                    error: 'Failed to retrieve user LLM settings',
                })
            }
        }
    }

    if (!llmApiUrl) {
        return res.status(503).json({
            error:
                'LLM service is not configured. Please contact your administrator or configure your own LLM settings.',
        })
    }

    // if model is not configured, the model hardcoded in the provider code will be used
    const modelNameForApi = personalModelName
        ? personalModelName
        : model || ((process.env.LLM_MODEL_NAME || process.env.LLM_AVAILABLE_MODELS || '').split(',')[0].trim())

    // overleaf-lab: honor the admin's explicit provider type for the SHARED
    // backend only; personal backends are detected from their own URL/key.
    const sharedApiUrl = adminLlmSettings.llmApiUrl || process.env.LLM_API_URL
    const chatApiType =
        llmApiUrl && llmApiUrl === sharedApiUrl ? adminLlmSettings.llmApiType : undefined

    const provider = createLLMProvider({ llmApiUrl, llmApiKey, llmApiType: chatApiType })

    try {
        // Prepend the admin-configured system prompt (if any) plus an always-on
        // instruction to reply in the user's language, then merge any client
        // system message. This keeps replies in the input language regardless of
        // whether an admin prompt is set.
        const languageInstruction = "Reply in the same language as the user's latest message (for example, answer in Italian if the user writes in Italian)."
        const adminSystemPrompt = await getSystemPrompt()
        const systemPreamble = adminSystemPrompt
            ? `${adminSystemPrompt}\n\n${languageInstruction}`
            : languageInstruction
        const hasSystemMessage = messages.length > 0 && messages[0].role === 'system'
        const finalMessages = hasSystemMessage
            ? [
                  { role: 'system', content: `${systemPreamble}\n\n${messages[0].content}` },
                  ...messages.slice(1),
              ]
            : [{ role: 'system', content: systemPreamble }, ...messages]

        const requestBody = {
            model: modelNameForApi,
            messages: finalMessages,
            max_tokens: 8192,
            temperature: 0.7,
        }

        const startTime = Date.now()

        logger.info(
            {
                projectId,
                model: modelNameForApi,
                url: llmApiUrl,
                isPersonalModel,
                maxTokens: 8192,
            },
            '[LLM] chat: sending request to LLM API'
        )

        const data = await provider.chat(requestBody)

        logger.info(
            { projectId, duration: `${Date.now() - startTime}ms`, model: modelNameForApi },
            '[LLM] chat: response sent successfully'
        )
        res.json(data)

    } catch (err) {
        const info = OError.getFullInfo(err)
        const errStatus  = info?.status || 500
        logger.error({ projectId, userId, err }, '[LLM] Error communicating with LLM service')
        return res.status(errStatus).json({
          error: err.message,
          details: info?.error?.message || err.cause?.message,
          status: errStatus,
        })
    }
}

async function completion(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { leftContext, rightContext, language, maxLength } =
        req.body

    logger.debug(
        {
            projectId,
            userId,
            language,
            maxLength,
            leftContextLen: leftContext?.length,
            rightContextLen: rightContext?.length,
        },
        '[LLM] completion: request received'
    )

    if (!leftContext && !rightContext) {
        return res.status(400).json({ success: false, error: 'No context provided' })
    }

    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ success: false, error: 'LLM service is disabled' })
    }

    // overleaf-lab: inline completion disabled by admin. Enforced before any
    // personal-settings resolution so a personal key cannot re-enable completion.
    // Return an empty suggestion so the editor simply shows nothing, with no error.
    const flags = await getLLMFeatureFlags()
    if (!flags.completionEnabled) {
        return res.json({ success: true, data: '' })
    }

    const adminLlmSettings = await getAdminLLMSettings()
    let llmApiUrl = adminLlmSettings.llmApiUrl || process.env.LLM_API_URL
    let llmApiKey = adminLlmSettings.llmApiKey || process.env.LLM_API_KEY

    // overleaf-lab: the admin can disable shared inline completion (a sentinel value
    // for the completion model). When disabled, only users with their own completion
    // route get suggestions; everyone else gets none. This keeps a self-hosted CPU
    // backend free from the high-frequency autocomplete load.
    const sharedCompletionDisabled = adminLlmSettings.completionModel === '__disabled__'

    // overleaf-lab: default completion model for the shared backend. Prefer the
    // admin-chosen completion model, then the env override, then the first env
    // model. May be overridden below by the user's personal completion settings.
    let completionModel =
        adminLlmSettings.completionModel ||
        process.env.LLM_COMPLETION_MODEL ||
        (process.env.LLM_MODEL_NAME || 'default').split(',')[0].trim() // 'default' instead of hardcoded 'qwen3-32b'

    // overleaf-lab: per-user inline-completion override (highest precedence). When
    // the user opted into their own provider AND explicitly picked a completion
    // model, route completion to their personal endpoint+key+model, overriding the
    // shared/local server. Incomplete personal creds -> silently fall back to shared.
    let usingPersonalCompletion = false
    if (userId) {
        try {
            const user = await User.findById(
                userId,
                'useOwnLLMSettings llmApiUrl llmApiKey llmCompletionModel'
            )
            if (
                user &&
                user.useOwnLLMSettings &&
                user.llmCompletionModel &&
                user.llmApiUrl &&
                user.llmApiKey
            ) {
                llmApiUrl = user.llmApiUrl
                llmApiKey = decryptSecret(user.llmApiKey) // decrypt stored key at rest
                completionModel = user.llmCompletionModel
                usingPersonalCompletion = true
            }
        } catch (error) {
            logger.warn({ userId, err: error }, '[LLM] Error loading user completion settings')
        }
    }

    // Try the user's own settings when NO shared server URL is configured, OR when
    // the admin disabled shared completion (so a user with their own API still gets
    // suggestions from their own endpoint).
    // overleaf-lab: gate on the URL alone (not the key). A keyless shared endpoint
    // is valid, so an empty key must NOT hijack completion onto the user's personal
    // endpoint while the shared one is fine. When we do fall back, also switch
    // completionModel to the user's own model, otherwise the env-derived 'default'
    // is sent to their endpoint (e.g. OpenAI 404s on model 'default').
    if (!usingPersonalCompletion && (!llmApiUrl || sharedCompletionDisabled) && userId) {
        try {
            const user = await User.findById(
                userId,
                'useOwnLLMSettings llmApiUrl llmApiKey llmModelName'
            )
            if (user && user.useOwnLLMSettings && user.llmApiUrl) {
                llmApiUrl = user.llmApiUrl
                llmApiKey = user.llmApiKey ? decryptSecret(user.llmApiKey) : '' // decrypt stored key at rest (empty when keyless)
                if (user.llmModelName) {
                    completionModel = user.llmModelName.split(',')[0].trim()
                }
            }
        } catch (error) {
            logger.warn({ userId, err: error }, '[LLM] Error loading user settings for completion')
        }
    }

    // overleaf-lab: shared completion disabled and no personal route resolved (the
    // completion model is still the sentinel) -> return an empty suggestion so the
    // editor simply shows nothing, with no error.
    if (completionModel === '__disabled__') {
        return res.json({ success: true, data: '' })
    }

    if (!llmApiUrl) {
        return res.status(503).json({ success: false, error: 'LLM service is not configured' })
    }

    // overleaf-lab: honor the admin's explicit provider type for the SHARED
    // backend only; personal backends are detected from their own URL/key.
    const sharedApiUrl = adminLlmSettings.llmApiUrl || process.env.LLM_API_URL
    const completionApiType =
        llmApiUrl && llmApiUrl === sharedApiUrl ? adminLlmSettings.llmApiType : undefined

    const provider = createLLMProvider({ llmApiUrl, llmApiKey, llmApiType: completionApiType })
    try {
        const systemPrompt = `/no_think\nYou are a text completion engine. Output ONLY the missing text, in the same language as the surrounding text. No thinking, no explanation, no markdown, no code fences, no tags. Just the raw continuation characters.`
        const userPrompt = `Complete the text at [CURSOR]. Output only the few words that replace [CURSOR]:\n\n${leftContext}[CURSOR]${rightContext}`

        const data = await provider.complete({
            model: completionModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: maxLength || 60,
        })

        res.json({ success: true, data })
    } catch (err) {
        const info = OError.getFullInfo(err)
        const errStatus  = info?.status || 500
        logger.error({ projectId, userId, err }, '[LLM] Completion error')
        return res.status(errStatus).json({
            success: false,
            error: 'Completion failed',
        })
    }
}

// overleaf-lab: expose the per-feature enable flags to the project UI so it can hide
// disabled features. allowUserSettings tells the client whether personal settings
// are available at all.
async function getFeatures(req, res) {
    const flags = await getLLMFeatureFlags()
    res.json({ ...flags, allowUserSettings: !!(Settings.llm && Settings.llm.allowUserSettings) })
}

// overleaf-lab: return a window of source lines around a compile-error line, so the
// "Ask AI about this error" prompt can include the actual code (not just the log
// message). Works for any project file via getAllDocs, so an error inside an
// \input-ed file that is not open in the editor is still covered.
async function getSourceContext(req, res) {
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.json({ ok: false, error: 'feature_disabled' })
    }

    const projectId = req.params.Project_id
    const rawFile = String(req.query.file || '')
    const line = parseInt(req.query.line, 10)
    let radius = parseInt(req.query.radius, 10)
    if (!Number.isFinite(radius) || radius < 0) {
        radius = 15
    }
    radius = Math.min(radius, 40) // overleaf-lab: cap the snippet size

    if (!rawFile || !Number.isFinite(line) || line < 1) {
        return res.json({ ok: false, error: 'bad_request' })
    }

    // overleaf-lab: normalize a log file path (may be /compile/x, ./x, or /x) to the
    // project doc path key used by getAllDocs.
    const norm = p =>
        String(p || '')
            .replace(/^\/?compile\//, '')
            .replace(/^\.\//, '')
            .replace(/^\//, '')

    try {
        const docsByPath = await ProjectEntityHandler.promises.getAllDocs(projectId)
        const target = norm(rawFile)
        const targetBase = target.split('/').pop()
        let match = null
        let baseMatch = null
        for (const [docPath, value] of Object.entries(docsByPath || {})) {
            if (!value) {
                continue
            }
            const np = norm(docPath)
            if (np === target || np.endsWith('/' + target) || target.endsWith('/' + np)) {
                match = { path: docPath, lines: value.lines || [] }
                break
            }
            if (!baseMatch && np.split('/').pop() === targetBase) {
                baseMatch = { path: docPath, lines: value.lines || [] }
            }
        }
        match = match || baseMatch
        if (!match) {
            return res.json({ ok: false, error: 'not_found' })
        }

        const lines = match.lines
        const idx = line - 1
        const start = Math.max(0, idx - radius)
        const end = Math.min(lines.length, idx + radius + 1)
        const numbered = []
        for (let i = start; i < end; i++) {
            // overleaf-lab: a leading '>' marks the line the compiler flagged.
            const marker = i === idx ? '>' : ' '
            numbered.push(`${marker} ${i + 1}: ${lines[i]}`)
        }

        return res.json({
            ok: true,
            file: match.path,
            line,
            startLine: start + 1,
            snippet: numbered.join('\n'),
        })
    } catch (err) {
        logger.warn({ projectId, err }, '[LLM] source-context failed')
        return res.json({ ok: false, error: 'failed' })
    }
}

// overleaf-lab: expose the EFFECTIVE editable prompts (admin override or default) to
// the project UI so the "Ask AI" toolbar and the "Ask AI about this error" button use
// the admin-tuned system prompt, action templates, and error instruction block. The
// review system prompt stays server-side and is not returned here.
async function getPrompts(req, res) {
    const prompts = await getLLMPrompts()
    res.json({
        askAiSystemPrompt: prompts.askAiSystemPrompt,
        errorPrompt: prompts.errorPrompt,
        askAiActionPrompts: prompts.askAiActionPrompts,
    })
}

// overleaf-lab: PR item 13 — whole-document generators (title / abstract /
// keywords). These operate on the ENTIRE project source (not a selection), so
// they live in the File menu rather than the selection toolbar. Project files
// are read server-side via the same getAllDocs pattern as getSourceContext.
// overleaf-lab: generous max_tokens on purpose — reasoning models (e.g. qwen3
// via Ollama) spend most of the budget on hidden thinking before emitting the
// answer; the instructions above still constrain visible output size.
const GENERATOR_TYPES = {
    title: {
        max_tokens: 2000,
        temperature: 0.4,
        instruction:
            'Write ONE concise, grammatically correct title for the document below. '
            + 'Return ONLY the title text — no quotes, no numbering, no explanation.',
    },
    abstract: {
        max_tokens: 4000,
        temperature: 0.3,
        instruction:
            'Write a structured abstract (150–250 words) for the document below: '
            + 'purpose, methods, key results/findings, and conclusion in that order. '
            + 'Return ONLY the abstract text — no heading, no quotes, no explanation.',
    },
    keywords: {
        max_tokens: 2000,
        temperature: 0.2,
        instruction:
            'Generate 5–8 keyword phrases for the document below that capture its '
            + 'core topics, methods, and domain. Return ONLY the keywords, '
            + 'separated by commas, in order of importance.',
    },
}

async function generateDocument(req, res) {
    const { type, model: requestedModel } = req.body
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    const spec = GENERATOR_TYPES[type]
    if (!spec) {
        return res.status(400).json({
            ok: false,
            error: 'bad_request',
            detail: `Unknown generator type. Expected one of: ${Object.keys(GENERATOR_TYPES).join(', ')}`,
        })
    }

    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ ok: false, error: 'llm_disabled' })
    }

    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.status(403).json({ ok: false, error: 'feature_disabled' })
    }

    logger.debug({ projectId, userId, type, hasModel: !!requestedModel }, '[LLM] generateDocument: request')

    try {
        // overleaf-lab: resolve credentials/model exactly like chat(): the request
        // model (if any), else the user's personal settings (when allowed and set),
        // else the shared admin backend.
        let llmApiUrl = null
        let llmApiKey = null
        let llmApiType = null
        let model = null

        if (requestedModel && requestedModel.startsWith('personal-') && userId) {
            const user = await User.findById(userId, 'useOwnLLMSettings llmApiUrl llmApiKey llmModelName')
            if (user && user.useOwnLLMSettings && user.llmApiUrl) {
                llmApiUrl = user.llmApiUrl
                llmApiKey = user.llmApiKey ? decryptSecret(user.llmApiKey) : ''
                model = requestedModel.substring('personal-'.length)
            }
        }

        const adminSettings = await getAdminLLMSettings()
        if (!llmApiUrl) {
            llmApiUrl = adminSettings.llmApiUrl || process.env.LLM_API_URL
            llmApiKey = adminSettings.llmApiKey || process.env.LLM_API_KEY
            llmApiType = adminSettings.llmApiType || null
        }
        if (!model) {
            model =
                (adminSettings.allowedModels || [])[0] ||
                (process.env.LLM_MODEL_NAME || '').split(',')[0].trim() ||
                null
        }

        if (!llmApiUrl || !model) {
            return res.status(503).json({
                ok: false,
                error: 'not_configured',
                detail: 'No LLM backend is configured',
            })
        }

        // overleaf-lab: concatenate every document in the project (LaTeX sources
        // first) with file headers, so multi-file projects are covered. The char
        // cap keeps worst-case prompts inside typical 32k–128k context windows;
        // the last files in a very large project lose the tail (titles/abstracts
        // rarely depend on the 100th appendix).
        const docsByPath = (await ProjectEntityHandler.promises.getAllDocs(projectId)) || {}
        const entries = Object.entries(docsByPath).filter(([, v]) => v && Array.isArray(v.lines))
        const isTex = p => /\.(tex|sty|cls|sty\.in|bib)$/i.test(String(p)) || /\btex\b/i.test(String(p))
        entries.sort((a, b) => Number(isTex(b[0])) - Number(isTex(a[0])))

        const perFileCap = 60000
        const totalCap = 240000
        let docText = ''
        const included = []
        for (const [docPath, value] of entries) {
            if (docText.length >= totalCap) {
                break
            }
            const text = (value.lines || []).join('\n')
            if (!text.trim()) {
                continue
            }
            const clipped = text.length > perFileCap ? text.slice(0, perFileCap) + '\n[...truncated...]' : text
            docText += `===== FILE: ${docPath} =====\n${clipped}\n\n`
            included.push(docPath)
        }

        if (!docText.trim()) {
            return res.status(422).json({
                ok: false,
                error: 'no_document',
                detail: 'The project contains no readable document file',
            })
        }

        // overleaf-lab: honor the admin's global writing system prompt and, when the
        // admin has tuned a matching action template (title/abstract), append it as
        // style guidance after the task instruction.
        const systemPrompt = (await getSystemPrompt()) || ''
        const templates = (await getLLMPrompts()).askAiActionPrompts || {}
        const styleGuidance = templates[type] ? `STYLE GUIDANCE from the author's template: ${templates[type]}\n\n` : ''

        const provider = createLLMProvider({ llmApiUrl, llmApiKey, llmApiType })
        const messages = []
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt })
        }
        messages.push({
            role: 'user',
            content: `${styleGuidance}${spec.instruction}\n\nDOCUMENT:\n${docText}`,
        })

        // overleaf-lab: provider.chat() returns the raw response OBJECT; use
        // chatDetailed() so `output` is the extracted content string (not
        // "[object Object]").
        const detailed = await provider.chatDetailed({
            model,
            messages,
            max_tokens: spec.max_tokens,
            temperature: spec.temperature,
        })
        const output = detailed?.content || ''

        const trimmed = String(output).trim()
        if (!trimmed) {
            return res.status(502).json({
                ok: false,
                error: 'empty_response',
                detail: 'The model returned an empty answer',
            })
        }

        logger.info({ projectId, userId, type, files: included.length, chars: docText.length }, '[LLM] generateDocument: ok')

        res.json({ ok: true, type, output: trimmed, model, files: included.length })
    } catch (err) {
        const info = OError.getFullInfo(err)
        logger.error({ projectId, userId, type, err }, '[LLM] generateDocument: failed')
        return res.status(info?.status || 502).json({
            ok: false,
            error: info?.error?.message || err.message,
        })
    }
}

export default {
    chat: expressify(chat),
    getModels: expressify(getModels),
    completion: expressify(completion),
    getFeatures: expressify(getFeatures),
    getSourceContext: expressify(getSourceContext),
    getPrompts: expressify(getPrompts),
    generateDocument: expressify(generateDocument),
}
