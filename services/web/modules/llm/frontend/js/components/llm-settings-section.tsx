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

type Props = {
    initialSettings?: {
        useOwnSettings?: boolean
        modelName?: string
        apiUrl?: string
        hasApiKey?: boolean
    }
}

export default function LLMSettingsSection({ initialSettings }: Props) {
    const { t } = useTranslation()
    const [useOwnLLMSettings, setUseOwnLLMSettings] = useState(
        initialSettings?.useOwnSettings || false
    )
    const [llmApiKey, setLlmApiKey] = useState('')
    const [llmModelName, setLlmModelName] = useState(
        initialSettings?.modelName || ''
    )
    const [llmApiUrl, setLlmApiUrl] = useState(initialSettings?.apiUrl || '')
    const [llmHasApiKey, setLlmHasApiKey] = useState(
        initialSettings?.hasApiKey || false
    )
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

    const handleCheckLLMConnection = async () => {
        setIsCheckingConnection(true)
        setConnectionCheckResult(null)
        try {
            const response = await postJSON('/user/llm-settings/check', {
                body: {
                    apiUrl: llmApiUrl,
                    apiKey: llmApiKey || undefined,
                    modelName: llmModelName,
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
                    llmModelName,
                    llmApiUrl,
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
            setConnectionCheckResult(null)

            runLlmAsync(
                postJSON('/user/llm-settings', {
                    body: {
                        useOwnLLMSettings: false,
                        llmApiKey: undefined,
                        llmModelName: '',
                        llmApiUrl: '',
                    },
                })
            ).catch(() => { })
        }
    }

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
                    <OLFormGroup controlId="llm-api-key-input">
                        <OLFormLabel>API Key</OLFormLabel>
                        <OLFormControl
                            type="password"
                            autoComplete="current-password"
                            value={llmApiKey}
                            onChange={e => setLlmApiKey(e.target.value)}
                            placeholder={llmHasApiKey ? '***' : 'Enter API Key'}
                        />
                        {llmHasApiKey && !llmApiKey && (
                            <OLFormText>
                                Existing API key is set. Enter a new one to update.
                            </OLFormText>
                        )}
                    </OLFormGroup>

                    <OLFormGroup controlId="llm-model-name-input">
                        <OLFormLabel>Model Name</OLFormLabel>
                        <OLFormControl
                            type="text"
                            value={llmModelName}
                            onChange={e => setLlmModelName(e.target.value)}
                            placeholder="e.g., gpt-4, claude-3"
                        />
                    </OLFormGroup>

                    <OLFormGroup controlId="llm-api-url-input">
                        <OLFormLabel>API URL</OLFormLabel>
                        <OLFormControl
                            type="text"
                            value={llmApiUrl}
                            onChange={e => setLlmApiUrl(e.target.value)}
                            placeholder="e.g., https://api.openai.com/v1"
                        />
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
                                (!llmApiKey && !llmHasApiKey) ||
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
