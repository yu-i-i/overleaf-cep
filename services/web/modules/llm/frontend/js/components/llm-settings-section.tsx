import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLNotification from '@/shared/components/ol/ol-notification'
import getMeta from '@/utils/meta'

type Props = {
    initialSettings?: {
        useOwnSettings?: boolean
        modelName?: string
        apiUrl?: string
        hasApiKey?: boolean
        completionModel?: string
    }
}

// overleaf-lab: provider presets. Selecting a known provider fills in its
// OpenAI-compatible base URL; "Custom" reveals the free-text URL field.
const OPENAI_URL = 'https://api.openai.com/v1'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1'

function providerFromUrl(url: string): 'openai' | 'anthropic' | 'custom' {
    if (url.includes('openai.com')) return 'openai'
    if (url.includes('anthropic.com')) return 'anthropic'
    return 'custom'
}

export default function LLMSettingsSection({ initialSettings }: Props) {
    const { t } = useTranslation()
    // overleaf-lab: super-admin feature flags for this user settings page. There
    // is no project id here, so the flags come from server-rendered meta (both
    // default to true when absent). Hide the personal chat-model UI when chat is
    // off and the inline-completion-model UI when completion is off. The backend
    // only renders this page when at least one is enabled.
    const chatEnabled = getMeta('ol-featureChatEnabled') !== false
    const completionEnabled = getMeta('ol-featureCompletionEnabled') !== false
    const [useOwnLLMSettings, setUseOwnLLMSettings] = useState(
        initialSettings?.useOwnSettings || false
    )
    const [llmApiKey, setLlmApiKey] = useState('')
    // overleaf-lab: true = the user explicitly asked to REMOVE the stored key
    const [clearLlmApiKey, setClearLlmApiKey] = useState(false)
    // overleaf-lab: llmModelName is a comma-separated list of personal chat
    // models; the first id is the default in the editor's chat model picker.
    const [llmModelName, setLlmModelName] = useState(
        initialSettings?.modelName || ''
    )
    const [llmApiUrl, setLlmApiUrl] = useState(initialSettings?.apiUrl || '')
    const [llmHasApiKey, setLlmHasApiKey] = useState(
        initialSettings?.hasApiKey || false
    )
    // overleaf-lab: per-user inline-completion model ('' = local/shared model)
    const [llmCompletionModel, setLlmCompletionModel] = useState(
        initialSettings?.completionModel || ''
    )
    const [customCompletionSelected, setCustomCompletionSelected] = useState(false)
    // overleaf-lab: provider selector, derived initially from the stored URL
    const [provider, setProvider] = useState<'openai' | 'anthropic' | 'custom'>(
        providerFromUrl(initialSettings?.apiUrl || '')
    )
    // overleaf-lab: model ids discovered via "Scan for models"
    const [scannedModels, setScannedModels] = useState<string[]>([])
    const [isScanning, setIsScanning] = useState(false)
    const [scanError, setScanError] = useState<string | null>(null)
    const [isCheckingConnection, setIsCheckingConnection] = useState(false)
    const [connectionCheckResult, setConnectionCheckResult] = useState<{
        success: boolean
        message: string
    } | null>(null)
    const {
        isLoading: isLlmSaving,
        isSuccess: isLlmSuccess,
        isError: isLlmError,
        error: llmError,
        runAsync: runLlmAsync,
    } = useAsync()

    const [showSuccessNotif, setShowSuccessNotif] = useState(false)
    useEffect(() => {
        if (isLlmSuccess) {
            setShowSuccessNotif(true)
            const timer = setTimeout(() => setShowSuccessNotif(false), 4000)
            return () => clearTimeout(timer)
        }
    }, [isLlmSuccess])

    const handleProviderChange = (value: string) => {
        const next = value as 'openai' | 'anthropic' | 'custom'
        setProvider(next)
        // Switching provider invalidates any previously scanned model list.
        setScannedModels([])
        setScanError(null)
        if (next === 'openai') {
            setLlmApiUrl(OPENAI_URL)
        } else if (next === 'anthropic') {
            setLlmApiUrl(ANTHROPIC_URL)
        }
        // 'custom' keeps whatever URL is currently entered and reveals the field.
    }

    const handleScanModels = async () => {
        setIsScanning(true)
        setScanError(null)
        try {
            const response = await postJSON('/user/llm-settings/models', {
                body: {
                    apiUrl: llmApiUrl,
                    apiKey: llmApiKey || undefined,
                },
            })
            setScannedModels(
                Array.isArray(response.models) ? response.models : []
            )
        } catch (err: any) {
            setScanError(err.message || 'Failed to scan for models')
            setScannedModels([])
        } finally {
            setIsScanning(false)
        }
    }

    const handleCheckLLMConnection = async () => {
        setIsCheckingConnection(true)
        setConnectionCheckResult(null)
        try {
            const response = await postJSON('/user/llm-settings/check', {
                body: {
                    apiUrl: llmApiUrl,
                    apiKey: llmApiKey || undefined,
                    // Check uses the default (first) chat model id.
                    modelName: llmModelName.split(',')[0].trim(),
                },
            })
            setConnectionCheckResult({
                success: true,
                message: response.message || 'Connection successful',
            })
        } catch (err: any) {
            setConnectionCheckResult({
                success: false,
                message: err.message || 'Connection failed',
            })
        } finally {
            setIsCheckingConnection(false)
        }
    }

    const handleSaveLLMSettings = () => {
        runLlmAsync(
            postJSON('/user/llm-settings', {
                body: {
                    useOwnLLMSettings,
                    llmApiKey: llmApiKey || undefined,
                    clearLlmApiKey,
                    llmModelName, // overleaf-lab: comma-separated chat model ids
                    llmApiUrl,
                    llmCompletionModel, // overleaf-lab: resolved completion model id ('' = local)
                },
            })
        )
            .then(() => {
                if (llmApiKey && llmApiKey.trim() !== '') {
                    setLlmHasApiKey(true)
                    setLlmApiKey('')
                }
            })
            .catch(() => { })
    }

    const handleToggleUseOwnLLMSettings = (checked: boolean) => {
        setUseOwnLLMSettings(checked)

        if (!checked) {
            setLlmApiKey('')
            setLlmModelName('')
            setLlmApiUrl('')
            setLlmCompletionModel('')
            setCustomCompletionSelected(false)
            setProvider('custom')
            setScannedModels([])
            setScanError(null)
            setConnectionCheckResult(null)

            runLlmAsync(
                postJSON('/user/llm-settings', {
                    body: {
                        useOwnLLMSettings: false,
                        llmApiKey: undefined,
                        clearLlmApiKey: true,
                        llmModelName: '',
                        llmApiUrl: '',
                        llmCompletionModel: '',
                    },
                })
            ).catch(() => { })
        }
    }

    // overleaf-lab: currently selected chat model ids (comma-separated -> array).
    const selectedChatModels = llmModelName
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)

    // Options for the multi-select: scanned ids plus any already-selected ids
    // that aren't in the scan (so an existing selection is always visible even
    // before scanning). Deduplicated, scanned ids first.
    const chatModelOptions = Array.from(
        new Set([...scannedModels, ...selectedChatModels])
    )

    const handleChatModelsSelect = (
        e: React.ChangeEvent<HTMLSelectElement>
    ) => {
        const selected = Array.from(e.target.selectedOptions).map(o => o.value)
        setLlmModelName(selected.join(','))
    }

    // overleaf-lab: the completion control is a binary choice: the shared model
    // chosen by the admin (value '') OR the user's OWN personal model. We never
    // present a list of shared/scanned models to pick from; the personal option
    // is a provider preset (a cheap model on the user's own endpoint) or a
    // custom id they type in below.
    const completionOptions: { value: string; label: string }[] = [
        { value: '', label: t('shared_completion_model_admin', 'Shared model (chosen by admin)') },
    ]
    if (llmApiUrl.includes('openai.com')) {
        completionOptions.push({ value: 'gpt-4.1-nano', label: 'gpt-4.1-nano' })
        completionOptions.push({ value: 'gpt-4o-mini', label: 'gpt-4o-mini' })
    }
    if (llmApiUrl.includes('anthropic.com')) {
        completionOptions.push({ value: 'claude-haiku-4-5', label: 'claude-haiku-4-5' })
    }
    completionOptions.push({
        value: '__custom__',
        label: t('other_enter_completion_model_id', 'Other (enter model id)…'),
    })

    // Real model ids offered as presets (includes '' for local; excludes the
    // synthetic '__custom__' sentinel). A stored value outside this set is custom.
    const completionPresetValues = completionOptions
        .map(o => o.value)
        .filter(v => v !== '__custom__')
    const showCustomCompletion =
        customCompletionSelected ||
        (llmCompletionModel !== '' && !completionPresetValues.includes(llmCompletionModel))
    const completionSelectValue = showCustomCompletion ? '__custom__' : llmCompletionModel

    const handleCompletionSelect = (value: string) => {
        if (value === '__custom__') {
            setCustomCompletionSelected(true)
        } else {
            setCustomCompletionSelected(false)
            setLlmCompletionModel(value)
        }
    }

    // overleaf-lab: only the URL is required — a local server may have no auth,
    // so an empty key is valid. A stored key (llmHasApiKey) still works too.
    const scanDisabled = isScanning || !llmApiUrl

    return (
        <>
            <OLFormGroup>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                        type="checkbox"
                        id="use-own-llm-settings"
                        checked={useOwnLLMSettings}
                        onChange={e => handleToggleUseOwnLLMSettings(e.target.checked)}
                        style={{ marginRight: '0.5rem' }}
                    />
                    <OLFormLabel htmlFor="use-own-llm-settings">
                        {t('use_my_own_llm_settings', 'Use my own LLM settings')}
                    </OLFormLabel>
                </div>
            </OLFormGroup>

            {useOwnLLMSettings && (
                <form
                    onSubmit={e => {
                        e.preventDefault()
                        handleSaveLLMSettings()
                    }}
                >
                    <OLFormGroup controlId="llm-provider-input">
                        <OLFormLabel>
                            {t('llm_provider', 'Provider')}
                        </OLFormLabel>
                        <select
                            id="llm-provider-input"
                            className="form-select"
                            value={provider}
                            onChange={e => handleProviderChange(e.target.value)}
                        >
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="custom">
                                {t('custom', 'Custom')}
                            </option>
                        </select>
                    </OLFormGroup>

                    <OLFormGroup controlId="llm-api-url-input">
                        <OLFormLabel>API URL</OLFormLabel>
                        {provider === 'custom' ? (
                            <OLFormControl
                                type="text"
                                value={llmApiUrl}
                                onChange={e => setLlmApiUrl(e.target.value)}
                                placeholder="e.g., https://api.openai.com/v1"
                            />
                        ) : (
                            <OLFormControl
                                type="text"
                                value={llmApiUrl}
                                readOnly
                                plaintext
                            />
                        )}
                    </OLFormGroup>

                    <OLFormGroup controlId="llm-api-key-input">
                        <OLFormLabel>API Key</OLFormLabel>
                        <OLFormControl
                            type="password"
                            autoComplete="current-password"
                            value={llmApiKey}
                            onChange={e => {
                                setLlmApiKey(e.target.value)
                                // overleaf-lab: typing a new key cancels a pending "remove"
                                if (e.target.value) {
                                    setClearLlmApiKey(false)
                                }
                            }}
                            placeholder={llmHasApiKey ? '***' : 'Enter API Key'}
                        />
                        {llmHasApiKey && !llmApiKey && (
                            <OLFormText>
                                Existing API key is set. Enter a new one to update.
                            </OLFormText>
                        )}
                        {llmHasApiKey && (
                            <OLButton
                                variant="link"
                                onClick={() => {
                                    setLlmApiKey('')
                                    setClearLlmApiKey(true)
                                }}
                            >
                                {t('llm_remove_key', 'Remove stored key')}
                            </OLButton>
                        )}
                    </OLFormGroup>

                    <OLFormGroup>
                        <OLButton
                            variant="secondary"
                            type="button"
                            onClick={handleScanModels}
                            disabled={scanDisabled}
                            isLoading={isScanning}
                            loadingLabel={t('scanning', 'Scanning…')}
                        >
                            {t('scan_for_models', 'Scan for models')}
                        </OLButton>
                        {scannedModels.length > 0 && (
                            <OLFormText>
                                {t(
                                    'scan_found_n_models',
                                    'Found {{count}} models.'
                                ).replace('{{count}}', String(scannedModels.length))}
                            </OLFormText>
                        )}
                    </OLFormGroup>

                    {scanError && (
                        <OLFormGroup>
                            <OLNotification type="error" content={scanError} />
                        </OLFormGroup>
                    )}

                    {/* overleaf-lab: personal CHAT model UI, hidden when the admin
                        disabled the chat feature for this user. */}
                    {chatEnabled && (
                        <OLFormGroup controlId="llm-chat-models-input">
                            <OLFormLabel>
                                {t('chat_models', 'Chat models')}
                            </OLFormLabel>
                            {chatModelOptions.length > 0 && (
                                <select
                                    id="llm-chat-models-input"
                                    className="form-select"
                                    multiple
                                    size={Math.min(
                                        8,
                                        Math.max(6, chatModelOptions.length)
                                    )}
                                    value={selectedChatModels}
                                    onChange={handleChatModelsSelect}
                                >
                                    {chatModelOptions.map(m => (
                                        <option key={m} value={m}>
                                            {m}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <OLFormControl
                                type="text"
                                value={llmModelName}
                                onChange={e => setLlmModelName(e.target.value)}
                                placeholder="e.g., gpt-4o, gpt-4.1"
                                style={{ marginTop: '0.5rem' }}
                            />
                            <OLFormText>
                                {t(
                                    'chat_models_help',
                                    'Pick one or more chat models (or type comma-separated ids). The first one is the default in the editor.'
                                )}
                            </OLFormText>
                        </OLFormGroup>
                    )}

                    {/* overleaf-lab: personal inline-COMPLETION model UI, hidden when
                        the admin disabled the completion feature for this user. */}
                    {completionEnabled && (
                        <OLFormGroup controlId="llm-completion-model-input">
                            <OLFormLabel>
                                {t('inline_completion_model', 'Inline completion model')}
                            </OLFormLabel>
                            <select
                                id="llm-completion-model-input"
                                className="form-select"
                                value={completionSelectValue}
                                onChange={e => handleCompletionSelect(e.target.value)}
                            >
                                {completionOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            {showCustomCompletion && (
                                <OLFormControl
                                    type="text"
                                    value={llmCompletionModel}
                                    onChange={e => setLlmCompletionModel(e.target.value)}
                                    placeholder="e.g., gpt-4o-mini"
                                    style={{ marginTop: '0.5rem' }}
                                />
                            )}
                            <OLFormText>
                                {t(
                                    'inline_completion_model_help',
                                    'Local / shared model is free and low-latency. gpt-4.1-nano / gpt-4o-mini cost roughly a few cents per month; claude-haiku costs more (completion runs at high frequency).'
                                )}
                            </OLFormText>
                        </OLFormGroup>
                    )}

                    <OLFormGroup>
                        <OLFormText>
                            {t(
                                'llm_cheap_models_hint',
                                'Cheap models — completion (high-frequency, keep it cheap): OpenAI gpt-4.1-nano / gpt-4o-mini · Anthropic claude-haiku-4-5. Chat (quality): OpenAI gpt-4o / gpt-4.1 · Anthropic claude-sonnet-4-6 / claude-sonnet-5. You can pick several chat models and switch between them in the editor.'
                            )}
                        </OLFormText>
                    </OLFormGroup>

                    {connectionCheckResult && (
                        <OLFormGroup>
                            <OLNotification
                                type={connectionCheckResult.success ? 'success' : 'error'}
                                content={connectionCheckResult.message}
                            />
                        </OLFormGroup>
                    )}

                    <OLFormGroup>
                        <OLButton
                            variant="secondary"
                            type="button"
                            onClick={handleCheckLLMConnection}
                            disabled={
                                isCheckingConnection ||
                                !llmApiUrl ||
                                !llmModelName
                            }
                            isLoading={isCheckingConnection}
                            loadingLabel="Checking..."
                            style={{ marginRight: '0.5rem' }}
                        >
                            Check Connection
                        </OLButton>
                        <OLButton
                            variant="primary"
                            type="submit"
                            disabled={isLlmSaving || !llmApiUrl || !llmModelName}
                            isLoading={isLlmSaving}
                            loadingLabel={t('saving') + '…'}
                        >
                            Save LLM Settings
                        </OLButton>
                    </OLFormGroup>

                    {showSuccessNotif && (
                        <OLFormGroup>
                            <OLNotification
                                type="success"
                                content="LLM settings saved successfully"
                            />
                        </OLFormGroup>
                    )}

                    {isLlmError && (
                        <OLFormGroup>
                            <OLNotification
                                type="error"
                                content={
                                    llmError?.message ?? 'Failed to save LLM settings'
                                }
                            />
                        </OLFormGroup>
                    )}
                </form>
            )}
        </>
    )
}
