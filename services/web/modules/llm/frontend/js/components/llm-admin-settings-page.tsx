import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLNotification from '@/shared/components/ol/ol-notification'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLBadge from '@/shared/components/ol/ol-badge'
import MaterialIcon from '@/shared/components/material-icon'

const DEFAULT_SYSTEM_PROMPT = `You are an expert LaTeX debugging assistant and compiler error specialist.

**Your Primary Role - Error Debugging:**
- Analyze LaTeX compilation errors and warnings
- Identify syntax mistakes, missing packages, and structural issues
- Explain errors in beginner-friendly language
- Provide working fixes with clear explanations

**When a user sends a compilation error:**

1. **Quick Summary** (1-2 sentences)
   - What's wrong in plain English

2. **The Problem**
   - Explain the error clearly
   - Point to the exact issue in their code

3. **The Fix**
   - Show corrected code in \`\`\`latex blocks
   - Highlight what changed

4. **Why This Happened**
   - Brief explanation of the root cause
   - How to prevent it in future

**Error Analysis Guidelines:**
- The line marked with → is where the error occurred
- Look at surrounding context for clues
- Common issues: typos in commands, missing packages, unmatched braces
- Check for: \\begin without \\end, missing $, wrong package names

**Also Helpful With:**
- General LaTeX syntax and commands
- Document structure and formatting
- Mathematical typesetting
- Bibliography and citations

**Response Style:**
- Be concise and practical
- Use code blocks for all LaTeX examples
- Assume the user is learning LaTeX
- Focus on solving the immediate problem first

Remember: The user is likely frustrated. Be encouraging and clear!`

const sectionStyle: React.CSSProperties = {
    padding: '1.5rem',
    borderRadius: '8px',
    border: '1px solid var(--border-color-01, #dee2e6)',
    backgroundColor: 'var(--bg-light-primary, #fff)',
    marginBottom: '1.25rem',
}

const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.25rem',
    fontSize: '1.1rem',
    fontWeight: 600,
}

const sectionDescStyle: React.CSSProperties = {
    color: 'var(--content-secondary, #6c757d)',
    fontSize: '0.875rem',
    marginBottom: '1.25rem',
}

const statusBadgeStyle = (variant: 'success' | 'error'): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: variant === 'success'
        ? 'var(--green-60, #198754)'
        : 'var(--red-60, #dc3545)',
})

const stepNumberStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.5rem',
    height: '1.5rem',
    borderRadius: '50%',
    backgroundColor: 'var(--bg-accent-01, #0d6efd)',
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 700,
    flexShrink: 0,
}

export default function LLMAdminSettingsPage() {
    const { t } = useTranslation()
    const hasStoredKey = getMeta('ol-hasLlmApiKey') === 'true'

    const [systemPrompt, setSystemPrompt] = useState<string>(
        (getMeta('ol-systemPrompt') as string) || DEFAULT_SYSTEM_PROMPT
    )
    const [llmApiUrl, setLlmApiUrl] = useState<string>(
        (getMeta('ol-llmApiUrl') as string) || ''
    )
    const [llmApiKey, setLlmApiKey] = useState<string>('')
    const [allowedModels, setAllowedModels] = useState<string[]>(
        ((getMeta('ol-allowedModels') as string) || '')
            .split(',')
            .map(m => m.trim())
            .filter(Boolean)
    )
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [scanStatus, setScanStatus] = useState<string | null>(null)
    const [testStatus, setTestStatus] = useState<string | null>(null)

    const {
        isLoading: isSaving,
        isSuccess,
        isError,
        error,
        runAsync,
    } = useAsync()

    const [showSuccess, setShowSuccess] = useState(false)
    useEffect(() => {
        if (isSuccess) {
            setShowSuccess(true)
            const timer = setTimeout(() => setShowSuccess(false), 4000)
            return () => clearTimeout(timer)
        }
    }, [isSuccess])

    const canConnect = !!llmApiUrl && (!!llmApiKey || hasStoredKey)

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault()
        runAsync(
            postJSON('/admin/llm/settings', {
                body: {
                    systemPrompt,
                    llmApiUrl,
                    llmApiKey,
                    allowedModels,
                },
            })
        ).catch(() => { })
    }

    const testConnection = async () => {
        setTestStatus('testing')
        try {
            const resp = await postJSON('/admin/llm/settings/check', {
                body: { apiUrl: llmApiUrl, apiKey: llmApiKey },
            })
            if (resp.success) {
                setTestStatus('success')
            } else {
                setTestStatus('error')
            }
        } catch (e) {
            setTestStatus('error')
        }
    }

    const scanModels = async () => {
        setScanStatus('scanning')
        try {
            const params = new URLSearchParams()
            if (llmApiUrl) params.set('apiUrl', llmApiUrl)
            if (llmApiKey) params.set('apiKey', llmApiKey)
            const resp = await fetch(`/admin/llm/models?${params.toString()}`, {
                method: 'GET',
                credentials: 'same-origin',
            })
            const json = await resp.json()
            if (json.success && Array.isArray(json.models)) {
                setAvailableModels(json.models)
                setScanStatus('success')
                setAllowedModels(prev => {
                    const combined = new Set([...prev, ...json.models])
                    return Array.from(combined)
                })
            } else {
                setScanStatus('error')
            }
        } catch {
            setScanStatus('error')
        }
    }

    const toggleAllowedModel = (model: string) => {
        setAllowedModels(prev =>
            prev.includes(model)
                ? prev.filter(m => m !== model)
                : [...prev, model]
        )
    }

    const allModels = Array.from(new Set([...availableModels, ...allowedModels]))

    return (
        <div className="container" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <OLRow>
                <OLCol>
                    <div style={{ padding: '2rem 0' }}>
                        {/* Page header */}
                        <div style={{ marginBottom: '2rem' }}>
                            <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <MaterialIcon type="smart_toy" />
                                {t('llm_configuration', 'LLM Configuration')}
                            </h1>
                            <p style={{ color: 'var(--content-secondary, #6c757d)', margin: 0 }}>
                                {t(
                                    'llm_admin_description',
                                    'Configure the AI assistant for your Overleaf instance. Set up the API connection, choose available models, and customize the system prompt.'
                                )}
                            </p>
                        </div>

                        <form onSubmit={handleSave}>
                            {/* ── Section 1: API Connection ── */}
                            <div style={sectionStyle}>
                                <div style={sectionHeaderStyle}>
                                    <span style={stepNumberStyle}>1</span>
                                    <MaterialIcon type="link" />
                                    {t('api_connection', 'API Connection')}
                                    {testStatus === 'success' && (
                                        <OLBadge bg="success" style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>
                                            {t('connected', 'Connected')}
                                        </OLBadge>
                                    )}
                                </div>
                                <p style={sectionDescStyle}>
                                    {t(
                                        'api_connection_desc',
                                        'Enter the endpoint URL and API key for your OpenAI-compatible LLM provider.'
                                    )}
                                </p>

                                <OLFormGroup controlId="llm-api-url">
                                    <OLFormLabel>
                                        {t('llm_api_url', 'API Endpoint URL')}
                                    </OLFormLabel>
                                    <OLFormControl
                                        type="url"
                                        value={llmApiUrl}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                            setLlmApiUrl(e.target.value)
                                        }
                                        placeholder="https://api.example.com/v1"
                                    />
                                </OLFormGroup>

                                <OLFormGroup controlId="llm-api-key" style={{ marginBottom: '1rem' }}>
                                    <OLFormLabel>
                                        {t('llm_api_key', 'API Key')}
                                    </OLFormLabel>
                                    <OLFormControl
                                        type="password"
                                        value={llmApiKey}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                            setLlmApiKey(e.target.value)
                                        }
                                        placeholder={
                                            hasStoredKey
                                                ? t('llm_api_key_placeholder_stored', '••••••••  (stored — leave blank to keep)')
                                                : t('llm_api_key_placeholder', 'Paste your API key here')
                                        }
                                    />
                                    {hasStoredKey && !llmApiKey && (
                                        <OLFormText>
                                            <MaterialIcon type="check_circle" className="me-1" style={{ fontSize: '0.875rem', color: 'var(--green-60, #198754)' }} />
                                            {t('llm_api_key_stored', 'An API key is already stored. Leave blank to keep it.')}
                                        </OLFormText>
                                    )}
                                </OLFormGroup>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <OLButton
                                        variant="secondary"
                                        size="sm"
                                        type="button"
                                        onClick={testConnection}
                                        disabled={!canConnect}
                                        isLoading={testStatus === 'testing'}
                                    >
                                        <MaterialIcon type="cable" className="me-1" style={{ fontSize: '1rem' }} />
                                        {t('test_connection', 'Test Connection')}
                                    </OLButton>
                                    {testStatus === 'success' && (
                                        <span style={statusBadgeStyle('success')}>
                                            <MaterialIcon type="check_circle" style={{ fontSize: '1rem' }} />
                                            {t('connection_successful', 'Connection successful')}
                                        </span>
                                    )}
                                    {testStatus === 'error' && (
                                        <span style={statusBadgeStyle('error')}>
                                            <MaterialIcon type="error" style={{ fontSize: '1rem' }} />
                                            {t('connection_failed', 'Connection failed — check URL and key')}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* ── Section 2: Model Selection ── */}
                            <div style={sectionStyle}>
                                <div style={sectionHeaderStyle}>
                                    <span style={stepNumberStyle}>2</span>
                                    <MaterialIcon type="model_training" />
                                    {t('model_selection', 'Model Selection')}
                                    {allModels.length > 0 && (
                                        <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--content-secondary, #6c757d)' }}>
                                            {allowedModels.filter(m => allModels.includes(m)).length}/{allModels.length} {t('selected', 'selected')}
                                        </span>
                                    )}
                                </div>
                                <p style={sectionDescStyle}>
                                    {t(
                                        'model_selection_desc',
                                        'Scan the API for available models, then choose which ones users can access.'
                                    )}
                                </p>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: allModels.length > 0 ? '1rem' : 0 }}>
                                    <OLButton
                                        variant="secondary"
                                        size="sm"
                                        type="button"
                                        onClick={scanModels}
                                        disabled={!canConnect}
                                        isLoading={scanStatus === 'scanning'}
                                    >
                                        <MaterialIcon type="radar" className="me-1" style={{ fontSize: '1rem' }} />
                                        {t('scan_for_models', 'Scan for Models')}
                                    </OLButton>
                                    {scanStatus === 'success' && (
                                        <span style={statusBadgeStyle('success')}>
                                            <MaterialIcon type="check_circle" style={{ fontSize: '1rem' }} />
                                            {t('scan_found_models', `Found ${availableModels.length} model(s)`)}
                                        </span>
                                    )}
                                    {scanStatus === 'error' && (
                                        <span style={statusBadgeStyle('error')}>
                                            <MaterialIcon type="error" style={{ fontSize: '1rem' }} />
                                            {t('scan_failed', 'Scan failed — check connection first')}
                                        </span>
                                    )}
                                    {!canConnect && scanStatus === null && (
                                        <span style={{ fontSize: '0.8125rem', color: 'var(--content-secondary, #6c757d)' }}>
                                            {t('configure_api_first', 'Configure the API connection above first')}
                                        </span>
                                    )}
                                </div>

                                {allModels.length > 0 && (
                                    <>
                                        <div style={{
                                            border: '1px solid var(--border-color-01, #dee2e6)',
                                            borderRadius: '6px',
                                            overflow: 'hidden',
                                        }}>
                                            {allModels.map((model, idx) => (
                                                <label
                                                    key={model}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.75rem',
                                                        padding: '0.625rem 1rem',
                                                        borderBottom: idx < allModels.length - 1
                                                            ? '1px solid var(--border-color-01, #dee2e6)'
                                                            : undefined,
                                                        cursor: 'pointer',
                                                        margin: 0,
                                                        transition: 'background-color 0.15s',
                                                    }}
                                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-light-secondary, #f8f9fa)' }}
                                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={allowedModels.includes(model)}
                                                        onChange={() => toggleAllowedModel(model)}
                                                        style={{ width: '1rem', height: '1rem', accentColor: 'var(--bg-accent-01, #0d6efd)' }}
                                                    />
                                                    <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                                        {model}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                            <OLButton
                                                variant="link"
                                                size="sm"
                                                type="button"
                                                onClick={() => setAllowedModels([...allModels])}
                                                style={{ padding: 0, fontSize: '0.8125rem' }}
                                            >
                                                {t('select_all', 'Select all')}
                                            </OLButton>
                                            <span style={{ color: 'var(--content-secondary, #6c757d)' }}>|</span>
                                            <OLButton
                                                variant="link"
                                                size="sm"
                                                type="button"
                                                onClick={() => setAllowedModels([])}
                                                style={{ padding: 0, fontSize: '0.8125rem' }}
                                            >
                                                {t('deselect_all', 'Deselect all')}
                                            </OLButton>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* ── Section 3: System Prompt ── */}
                            <div style={sectionStyle}>
                                <div style={sectionHeaderStyle}>
                                    <span style={stepNumberStyle}>3</span>
                                    <MaterialIcon type="description" />
                                    {t('system_prompt', 'System Prompt')}
                                </div>
                                <p style={sectionDescStyle}>
                                    {t(
                                        'system_prompt_desc',
                                        'This prompt is prepended to every AI conversation. Use it to customize the assistant\'s behavior for your organization.'
                                    )}
                                </p>

                                <OLFormGroup controlId="llm-system-prompt" style={{ marginBottom: '0.5rem' }}>
                                    <OLFormControl
                                        as="textarea"
                                        rows={12}
                                        value={systemPrompt}
                                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                            setSystemPrompt(e.target.value)
                                        }
                                        placeholder={t(
                                            'llm_system_prompt_placeholder',
                                            'You are a helpful LaTeX assistant...'
                                        )}
                                        maxLength={4000}
                                        style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                                    />
                                </OLFormGroup>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <OLFormText style={{ margin: 0 }}>
                                        {systemPrompt.length}/4000 {t('characters', 'characters')}
                                    </OLFormText>
                                    <OLButton
                                        variant="link"
                                        size="sm"
                                        type="button"
                                        onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                                        style={{ padding: 0, fontSize: '0.8125rem' }}
                                    >
                                        <MaterialIcon type="restart_alt" className="me-1" style={{ fontSize: '1rem' }} />
                                        {t('reset_to_default', 'Reset to default')}
                                    </OLButton>
                                </div>
                            </div>

                            {/* ── Notifications ── */}
                            {showSuccess && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <OLNotification
                                        type="success"
                                        content={t('llm_settings_saved', 'LLM settings saved successfully.')}
                                    />
                                </div>
                            )}
                            {isError && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <OLNotification
                                        type="error"
                                        content={
                                            (error as any)?.message ??
                                            t('generic_something_went_wrong', 'Something went wrong')
                                        }
                                    />
                                </div>
                            )}

                            {/* ── Save Button ── */}
                            <OLButton
                                variant="primary"
                                type="submit"
                                disabled={isSaving}
                                isLoading={isSaving}
                                loadingLabel={t('saving') + '…'}
                                style={{ minWidth: '160px' }}
                            >
                                <MaterialIcon type="save" className="me-1" style={{ fontSize: '1.125rem' }} />
                                {t('save_settings', 'Save Settings')}
                            </OLButton>
                        </form>
                    </div>
                </OLCol>
            </OLRow>
        </div>
    )
}
