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
import OLBadge from '@/shared/components/ol/ol-badge'
import MaterialIcon from '@/shared/components/material-icon'
import {
  Dropdown,
  DropdownToggle,
  DropdownMenu,
  DropdownItem,
} from '@/shared/components/dropdown/dropdown-menu'
import '../../stylesheets/llm-settings.scss'

const LLM_API_TYPES = [
  { name: 'openai', label: 'OpenAI' },
  { name: 'anthropic', label: 'Anthropic' },
]

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

// overleaf-lab: a small accessible toggle switch (styled from a button) used for
// the per-feature enable/disable controls.
function ToggleSwitch({
    checked,
    onChange,
    label,
}: {
    checked: boolean
    onChange: (v: boolean) => void
    label?: string
}) {
    return (
        <OLButton
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => onChange(!checked)}
            style={{
                position: 'relative',
                width: 42,
                height: 24,
                flexShrink: 0,
                borderRadius: 999,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transition: 'background-color 0.15s',
                backgroundColor: checked
                    ? 'var(--bg-accent-01, #0d6efd)'
                    : 'var(--border-color-02, #adb5bd)',
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: 3,
                    left: checked ? 21 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    backgroundColor: '#fff',
                    transition: 'left 0.15s',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }}
            />
        </OLButton>
    )
}

export default function LLMAdminSettingsPage() {
    const { t } = useTranslation()
    const hasStoredKey = getMeta('ol-hasLlmApiKey') === 'true'
    // overleaf-lab: true when the shown URL is inherited from the LLM_API_URL env
    // var rather than saved in the admin settings file.
    const apiUrlFromEnv = getMeta('ol-llmApiUrlFromEnv') === 'true'
    const apiTypeFromEnv = getMeta('ol-llmApiTypeFromEnv') === 'true'

    const [systemPrompt, setSystemPrompt] = useState<string>(
        (getMeta('ol-systemPrompt') as string) || DEFAULT_SYSTEM_PROMPT
    )
    const [llmApiUrl, setLlmApiUrl] = useState<string>(
        (getMeta('ol-llmApiUrl') as string) || ''
    )
    const [llmApiType, setLlmApiType] = useState<string>(
        (getMeta('ol-llmApiType') as string) || ''
    )
    const [llmApiKey, setLlmApiKey] = useState<string>('')
    // overleaf-lab: true = the user explicitly asked to REMOVE the stored key
    // (blank input otherwise keeps the stored key).
    const [clearLlmApiKey, setClearLlmApiKey] = useState(false)
    const [allowedModels, setAllowedModels] = useState<string[]>(
        ((getMeta('ol-allowedModels') as string) || '')
            .split(',')
            .map(m => m.trim())
            .filter(Boolean)
    )
    const [availableModels, setAvailableModels] = useState<string[]>([])
    // overleaf-lab: item 8 — the FULL model list found by a scan/test (including
    // unchecked models), persisted so unchecked models stay visible across reloads.
    const [knownModels, setKnownModels] = useState<string[]>(
        ((getMeta('ol-knownModels') as string) || '')
            .split(',')
            .map(m => m.trim())
            .filter(Boolean)
    )
    // overleaf-lab: admin-chosen inline-completion model for the shared backend
    // ('' = auto, i.e. the first allowed model). Separate from the chat models.
    const [completionModel, setCompletionModel] = useState<string>(
        (getMeta('ol-completionModel') as string) || ''
    )
    // overleaf-lab: compliance review settings. Rubrics come from a data-type='json'
    // meta tag, so getMeta returns the parsed value; guard in case it is not an array.
    const rubricsFromMeta = getMeta('ol-complianceRubrics') as Array<{ id: string; name: string; guidelines: string; scanPatterns?: string }>
    const initialRubrics = Array.isArray(rubricsFromMeta) ? rubricsFromMeta : []
    const [complianceRubrics, setComplianceRubrics] = useState<Array<{ id: string; name: string; guidelines: string; scanPatterns?: string }>>(initialRubrics)
    const [reviewModel, setReviewModel] = useState<string>((getMeta('ol-reviewModel') as string) || '')
    const [maxContextTokens, setMaxContextTokens] = useState<number>(parseInt((getMeta('ol-maxContextTokens') as string) || '32000', 10) || 32000)
    // overleaf-lab: budget for the review's JSON answer (the model's max_tokens and
    // the room reserved for it in the context check).
    const [reviewMaxTokens, setReviewMaxTokens] = useState<number>(parseInt((getMeta('ol-reviewMaxTokens') as string) || '12000', 10) || 12000)
    // overleaf-lab: per-feature enable/disable toggles. The metas use data-type='json'
    // so getMeta returns the parsed boolean; default to true when missing/undefined.
    const [chatEnabled, setChatEnabled] = useState<boolean>(getMeta('ol-chatEnabled') !== false)
    const [completionEnabled, setCompletionEnabled] = useState<boolean>(getMeta('ol-completionEnabled') !== false)
    const [reviewEnabled, setReviewEnabled] = useState<boolean>(getMeta('ol-reviewEnabled') !== false)
    // overleaf-lab: editable AI prompts. Empty field means the backend uses its
    // built-in default; promptDefaults feeds the per-field reset buttons.
    const promptDefaults = (getMeta('ol-promptDefaults') as any) || {}
    const [askAiSystemPrompt, setAskAiSystemPrompt] = useState<string>((getMeta('ol-askAiSystemPrompt') as string) || '')
    const [errorPrompt, setErrorPrompt] = useState<string>((getMeta('ol-errorPrompt') as string) || '')
    const [reviewSystemPrompt, setReviewSystemPrompt] = useState<string>((getMeta('ol-reviewSystemPrompt') as string) || '')
    const initialActions = (getMeta('ol-askAiActionPrompts') as Record<string, string>) || {}
    const [askAiActionPrompts, setAskAiActionPrompts] = useState<Record<string, string>>(initialActions && typeof initialActions === 'object' ? initialActions : {})
    // overleaf-lab: keep the Ask AI action templates block collapsed by default
    const [showActions, setShowActions] = useState(false)
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

    // overleaf-lab: only the URL and its type are required — a local llama.cpp server has no
    // auth, so scan/test must work with an empty key. The server returns 401 if
    // it actually needs one.
    const canConnect = !!llmApiUrl && !!llmApiType
    const selectedApiType = LLM_API_TYPES.find(t => t.name === llmApiType)

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault()
        runAsync(
            postJSON('/admin/llm/settings', {
                body: {
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
                    askAiSystemPrompt,
                    errorPrompt,
                    reviewSystemPrompt,
                    askAiActionPrompts,
                },
            })
        ).catch(() => { })
    }

    const testConnection = async () => {
        setTestStatus('testing')
        try {
            const resp = await postJSON('/admin/llm/settings/check', {
                body: { apiUrl: llmApiUrl, apiKey: llmApiKey, apiType: llmApiType },
            })
            if (resp.success) {
                setTestStatus('success')
                // overleaf-lab: item 7 — test = model-list fetch: a successful test
                // returns the backend's model list, so adopt it in the same round
                // trip (no separate scan needed).
                if (Array.isArray(resp.models)) {
                    setKnownModels(prev => Array.from(new Set([...prev, ...resp.models])))
                }
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
            const resp = await postJSON('/admin/llm/models', {
                body: {
                    apiUrl: llmApiUrl,
                    apiKey: llmApiKey,
                    apiType: llmApiType,
                },
            })
            if (resp.success && Array.isArray(resp.models)) {
                setAvailableModels(resp.models)
                setScanStatus('success')
                setKnownModels(prev => Array.from(new Set([...prev, ...resp.models])))
                setAllowedModels(prev => {
                    const combined = new Set([...prev, ...resp.models])
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

    // overleaf-lab: compliance rubric editing helpers. Each rubric keeps a stable
    // client-generated id so React keys and immutable updates stay correct.
    const addRubric = () => {
        const id = `rubric-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setComplianceRubrics(prev => [...prev, { id, name: '', guidelines: '', scanPatterns: '' }])
    }

    const updateRubric = (id: string, field: 'name' | 'guidelines' | 'scanPatterns', value: string) => {
        setComplianceRubrics(prev =>
            prev.map(r => (r.id === id ? { ...r, [field]: value } : r))
        )
    }

    const removeRubric = (id: string) => {
        setComplianceRubrics(prev => prev.filter(r => r.id !== id))
    }

    const allModels = Array.from(new Set([...knownModels, ...availableModels, ...allowedModels]))

    return (
        <div className="container llm-settings">
          {/* Page header */}
          <div className="llm-settings-header">
              <h1 className="llm-settings-header-title">
                  <MaterialIcon type="smart_toy" />
                  {t('llm_configuration', 'LLM Configuration')}
              </h1>
              <p className="llm-settings-header-desc">
                  {t(
                      'llm_admin_description',
                      'Configure the AI assistant for your Overleaf instance. Set up the API connection, choose available models, and customize the system prompt.'
                  )}
              </p>
          </div>

          <form onSubmit={handleSave}>
              {/* ── Section 1: Features ── */}
              {/* overleaf-lab: master on/off switches per AI feature */}
              <div className="llm-settings-section">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">1</span>
                      <MaterialIcon type="toggle_on" />
                      {t('llm_features', 'Features')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'llm_features_desc',
                          'Enable or disable each AI feature for all users. A disabled feature cannot be used by anyone, even with their own API key.'
                      )}
                  </p>

                  <div className="llm-settings-section-body">
                      {/* overleaf-lab: one toggle switch per feature */}
                      {[
                          { key: 'chat', on: chatEnabled, set: setChatEnabled, title: t('feature_chat', 'Chat'), help: t('feature_chat_help', 'The AI chat panel and Ask AI on selection.') },
                          { key: 'completion', on: completionEnabled, set: setCompletionEnabled, title: t('feature_completion', 'Inline completion'), help: t('feature_completion_help', 'Autocomplete suggestions while typing.') },
                          { key: 'review', on: reviewEnabled, set: setReviewEnabled, title: t('feature_review', 'Compliance review'), help: t('feature_review_help', 'The whole-document review.') },
                      ].map((f, i, arr) => (
                          <div
                              key={f.key}
                              style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '1rem',
                                  padding: '0.75rem 1rem',
                                  borderBottom: i < arr.length - 1 ? '1px solid var(--border-color-01, #dee2e6)' : undefined,
                              }}
                          >
                              <div>
                                  <span style={{ fontWeight: 500 }}>{f.title}</span>
                                  <OLFormText style={{ margin: 0 }}>{f.help}</OLFormText>
                              </div>
                              <ToggleSwitch checked={f.on} onChange={f.set} label={f.title} />
                          </div>
                      ))}
                  </div>
              </div>

              {/* ── Section 2: API Connection ── */}
              <div className="llm-settings-section">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">2</span>
                      <MaterialIcon type="link" />
                      {t('api_connection', 'API Connection')}
                      {testStatus === 'success' && (
                          <OLBadge bg="success" style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>
                              {t('connected', 'Connected')}
                          </OLBadge>
                      )}
                  </div>
                  <p className="llm-settings-section-desc">
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
                      {apiUrlFromEnv && (
                          <OLFormText>
                              <MaterialIcon type="info" className="me-1" style={{ fontSize: '0.875rem' }} />
                              {t('llm_admin_from_env', 'Inherited from the LLM_API_URL environment variable. Saving here stores it in the admin settings file.')}
                          </OLFormText>
                      )}
                  </OLFormGroup>

                  <OLFormGroup controlId="llm-api-type">
                      <OLFormLabel>
                          {t('llm_api_type', 'API Type')}
                      </OLFormLabel>
                      <div>
                      <Dropdown>
                          <DropdownToggle
                            id="llm-api-type-dropdown"
                            className="btn-secondary"
                            aria-label="Select LLM API type"
                          >
                            <span className="text-truncate" aria-hidden>
                              {selectedApiType?.label ?? 'Select API type'}
                            </span>
                          </DropdownToggle>

                          <DropdownMenu flip={false}>
                            {LLM_API_TYPES.map(apiType => (
                              <DropdownItem
                                key={apiType.name}
                                active={apiType.name === llmApiType}
                                onClick={() => setLlmApiType(apiType.name)}
                              >
                                {apiType.label}
                              </DropdownItem>
                            ))}
                          </DropdownMenu>
                      </Dropdown>
                      </div>

                      {apiTypeFromEnv && (
                          <OLFormText>
                            <MaterialIcon
                              type="info"
                              className="me-1"
                              style={{ fontSize: '0.875rem' }}
                            />
                            {t(
                              'llm_type_from_env',
                              'Inherited from the LLM_API_TYPE environment variable. Saving here stores it in the admin settings file.'
                            )}
                          </OLFormText>
                      )}
                  </OLFormGroup>

                  <OLFormGroup controlId="llm-api-key" style={{ marginBottom: '1rem' }}>
                      <OLFormLabel>
                          {t('llm_api_key', 'API Key')}
                      </OLFormLabel>
                      <OLFormControl
                          type="password"
                          value={llmApiKey}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              setLlmApiKey(e.target.value)
                              // overleaf-lab: typing a new key cancels a pending "remove"
                              if (e.target.value) {
                                  setClearLlmApiKey(false)
                              }
                          }}
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
                      <OLFormText>
                          <MaterialIcon type="info" className="me-1" style={{ fontSize: '0.875rem' }} />
                          {t('llm_api_key_optional_local', 'Leave blank for a local server with no auth (e.g. a llama.cpp server).')}
                      </OLFormText>
                      {hasStoredKey && (
                          <OLButton
                              variant="link"
                              onClick={() => {
                                  setLlmApiKey('')
                                  setClearLlmApiKey(true)
                              }}
                          >
                              {t('llm_api_key_remove', 'Remove stored key')}
                          </OLButton>
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
                          <span className="llm-settings-section-status llm-settings-section-status-success">
                              <MaterialIcon type="check_circle" className="llm-settings-section-status-icon" />
                              {t('connection_successful', 'Connection successful')}
                          </span>
                      )}
                      {testStatus === 'error' && (
                          <span className="llm-settings-section-status llm-settings-section-status-error">
                              <MaterialIcon type="error" className="llm-settings-section-status-icon" />
                              {t('connection_failed', 'Connection failed — check URL and key')}
                          </span>
                      )}
                  </div>
              </div>

              {/* ── Section 3: Model Selection ── */}
              <div className="llm-settings-section">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">3</span>
                      <MaterialIcon type="model_training" />
                      {t('model_selection', 'Model Selection')}
                      {allModels.length > 0 && (
                          <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--content-secondary, #6c757d)' }}>
                              {allowedModels.filter(m => allModels.includes(m)).length}/{allModels.length} {t('selected', 'selected')}
                          </span>
                      )}
                  </div>
                  <p className="llm-settings-section-desc">
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
                          <span className="llm-settings-section-status llm-settings-section-status-success">
                              <MaterialIcon type="check_circle" className="llm-settings-section-status-icon" />
                              {t('scan_found_models', `Found ${availableModels.length} model(s)`)}
                          </span>
                      )}
                      {scanStatus === 'error' && (
                          <span className="llm-settings-section-status llm-settings-section-status-error">
                              <MaterialIcon type="error" className="llm-settings-section-status-icon" />
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
                                  {t('unselect_all', 'Unselect all')}
                              </OLButton>
                          </div>
                      </>
                  )}

                  {/* overleaf-lab: admin picks the single shared inline-completion model */}
                  <OLFormGroup controlId="llm-completion-model" style={{ marginTop: allModels.length > 0 ? '1rem' : 0 }}>
                      <OLFormLabel>
                          {t('inline_completion_model', 'Inline completion model')}
                      </OLFormLabel>
                      <Dropdown>
                        <DropdownToggle
                          id="llm-completion-model-dropdown"
                          className="btn-secondary"
                          aria-label="Select completion model"
                        >
                          <span className="text-truncate" aria-hidden>
                            {completionModel
                              ? completionModel === '__disabled__'
                                ? t(
                                    'completion_disabled_shared',
                                    'Disabled (only users with their own API key)'
                                  )
                                : completionModel
                              : t('auto_first_allowed_model', 'Auto (first allowed model)')}
                          </span>
                        </DropdownToggle>

                        <DropdownMenu flip={false}>
                          <DropdownItem
                            active={completionModel === ''}
                            onClick={() => setCompletionModel('')}
                          >
                            {t('auto_first_allowed_model', 'Auto (first allowed model)')}
                          </DropdownItem>

                          {/* overleaf-lab: turn off shared autocomplete; users can still use their own API key */}
                          <DropdownItem
                            active={completionModel === '__disabled__'}
                            onClick={() => setCompletionModel('__disabled__')}
                          >
                            {t(
                              'completion_disabled_shared',
                              'Disabled (only users with their own API key)'
                            )}
                          </DropdownItem>

                          {allModels.map(model => (
                            <DropdownItem
                              key={model}
                              active={model === completionModel}
                              onClick={() => setCompletionModel(model)}
                            >
                              {model}
                            </DropdownItem>
                          ))}
                        </DropdownMenu>
                      </Dropdown>
                      <OLFormText>
                          {t(
                              'inline_completion_model_admin_help',
                              'Model used for inline autocomplete on the shared backend. Can differ from the chat models. Set to Disabled to turn off shared autocomplete (users with their own API key still get it).'
                          )}
                      </OLFormText>
                  </OLFormGroup>
              </div>

              {/* ── Section 4: System Prompt ── */}
              <div className="llm-settings-section">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">4</span>
                      <MaterialIcon type="description" />
                      {t('system_prompt', 'System Prompt')}
                  </div>
                  <p className="llm-settings-section-desc">
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

              {/* ── Section 5: Compliance Review ── */}
              <div className="llm-settings-section">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">5</span>
                      <MaterialIcon type="fact_check" />
                      {t('compliance_review', 'Compliance Review')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'compliance_review_desc',
                          'Configure the document compliance review: the guideline rubrics users can check against, the model that runs the review, and the maximum context size.'
                      )}
                  </p>

                  {/* overleaf-lab: (a) rubrics editor */}
                  {complianceRubrics.length === 0 && (
                      <p style={{ color: 'var(--content-secondary, #6c757d)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                          {t('no_rubrics_yet', 'No rubrics yet. Add one to enable the compliance review for users.')}
                      </p>
                  )}
                  {complianceRubrics.map(rubric => (
                      <div
                          key={rubric.id}
                          style={{
                              border: '1px solid var(--border-color-01, #dee2e6)',
                              borderRadius: '6px',
                              padding: '1rem',
                              marginBottom: '0.75rem',
                          }}
                      >
                          <OLFormGroup controlId={`rubric-name-${rubric.id}`}>
                              <OLFormLabel>
                                  {t('rubric_name', 'Rubric name')}
                              </OLFormLabel>
                              <OLFormControl
                                  type="text"
                                  value={rubric.name}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                      updateRubric(rubric.id, 'name', e.target.value)
                                  }
                                  placeholder={t('rubric_name_placeholder', 'e.g. Thesis writing guidelines')}
                              />
                          </OLFormGroup>
                          <OLFormGroup controlId={`rubric-guidelines-${rubric.id}`} style={{ marginBottom: '0.5rem' }}>
                              <OLFormLabel>
                                  {t('rubric_guidelines', 'Guidelines')}
                              </OLFormLabel>
                              <OLFormControl
                                  as="textarea"
                                  rows={6}
                                  value={rubric.guidelines}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                      updateRubric(rubric.id, 'guidelines', e.target.value)
                                  }
                                  style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                              />
                          </OLFormGroup>
                          {/* overleaf-lab: per-rubric mechanical scans; policy
                              patterns live next to the guidelines they verify */}
                          <OLFormGroup controlId={`rubric-scans-${rubric.id}`} style={{ marginBottom: '0.5rem' }}>
                              <OLFormLabel>
                                  {t('rubric_scan_patterns', 'Scan patterns (optional, one per line)')}
                              </OLFormLabel>
                              <OLFormControl
                                  as="textarea"
                                  rows={3}
                                  value={rubric.scanPatterns || ''}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                      updateRubric(rubric.id, 'scanPatterns', e.target.value)
                                  }
                                  placeholder={'First person :: (?<![\\w.@/])(io|noi|ho)\\b\nWikipedia :: wikipedia'}
                                  style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                              />
                              <OLFormText>
                                  {t(
                                      'rubric_scan_patterns_help',
                                      '"Label :: regex" (case-insensitive; a plain word works too). The whole source is scanned in code, exhaustively, and the matches are handed to the model as candidates to judge in context. Use it for the pattern-like requirements of THIS rubric (words to avoid, forbidden constructs), in the language of your guidelines.'
                                  )}
                              </OLFormText>
                          </OLFormGroup>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <OLButton
                                  variant="danger"
                                  size="sm"
                                  type="button"
                                  onClick={() => removeRubric(rubric.id)}
                              >
                                  <MaterialIcon type="delete" className="me-1" style={{ fontSize: '1rem' }} />
                                  {t('remove', 'Remove')}
                              </OLButton>
                          </div>
                      </div>
                  ))}
                  <div style={{ marginBottom: '0.5rem' }}>
                      <OLButton
                          variant="secondary"
                          size="sm"
                          type="button"
                          onClick={addRubric}
                      >
                          <MaterialIcon type="add" className="me-1" style={{ fontSize: '1rem' }} />
                          {t('add_rubric', 'Add rubric')}
                      </OLButton>
                  </div>
                  <OLFormText>
                      {t(
                          'compliance_rubrics_help',
                          'Paste your thesis or internship writing guidelines. The AI checks the whole document against each rubric and returns a report.'
                      )}
                  </OLFormText>

                  {/* overleaf-lab: (b) review model selector */}
                  <OLFormGroup controlId="llm-review-model" style={{ marginTop: '1.25rem' }}>
                      <OLFormLabel>
                          {t('review_model', 'Review model')}
                      </OLFormLabel>
                      <Dropdown>
                        <DropdownToggle
                          id="llm-review-model-dropdown"
                          className="btn-secondary"
                          aria-label="Select review model"
                        >
                          <span className="text-truncate" aria-hidden>
                            {reviewModel
                              ? reviewModel
                              : t('review_model_shared_default', 'Shared chat model (default)')}
                          </span>
                        </DropdownToggle>

                        <DropdownMenu flip={false}>
                          <DropdownItem
                            active={reviewModel === ''}
                            onClick={() => setReviewModel('')}
                          >
                            {t('review_model_shared_default', 'Shared chat model (default)')}
                          </DropdownItem>

                          {allModels.map(model => (
                            <DropdownItem
                              key={model}
                              active={model === reviewModel}
                              onClick={() => setReviewModel(model)}
                            >
                              {model}
                            </DropdownItem>
                          ))}
                        </DropdownMenu>
                      </Dropdown>
                      <OLFormText>
                          {t(
                              'review_model_help',
                              'Model used to run the compliance review. Pick a large-context model. Defaults to the shared chat model.'
                          )}
                      </OLFormText>
                  </OLFormGroup>

                  {/* overleaf-lab: (c) max context tokens */}
                  <OLFormGroup controlId="llm-max-context-tokens" style={{ marginTop: '1rem', marginBottom: 0 }}>
                      <OLFormLabel>
                          {t('max_context_tokens', 'Max context tokens')}
                      </OLFormLabel>
                      <OLFormControl
                          type="number"
                          value={maxContextTokens}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const parsed = parseInt(e.target.value, 10)
                              if (!isNaN(parsed)) {
                                  setMaxContextTokens(parsed)
                              }
                          }}
                      />
                      <OLFormText>
                          {t(
                              'max_context_tokens_help',
                              'The context window (in tokens) of the review model, as configured on your llama.cpp server (the -c value, divided by --parallel). The review refuses documents that would not fit. No auto-detection.'
                          )}
                      </OLFormText>
                  </OLFormGroup>

                  {/* overleaf-lab: budget for the review answer itself */}
                  <OLFormGroup controlId="llm-review-max-tokens" style={{ marginTop: '1rem', marginBottom: 0 }}>
                      <OLFormLabel>
                          {t('review_max_tokens', 'Review answer budget (tokens)')}
                      </OLFormLabel>
                      <OLFormControl
                          type="number"
                          value={reviewMaxTokens}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const parsed = parseInt(e.target.value, 10)
                              if (!isNaN(parsed)) {
                                  setReviewMaxTokens(parsed)
                              }
                          }}
                      />
                      <OLFormText>
                          {t(
                              'review_max_tokens_help',
                              'Upper limit for the answer of each review pass. The actual room adapts to what the document leaves free inside Max context tokens, so a large value here never blocks a long document; it only allows more thorough per-requirement analyses when there is room.'
                          )}
                      </OLFormText>
                  </OLFormGroup>

              </div>

              {/* ── Section 6: AI Prompts ── */}
              {/* overleaf-lab: editable prompts behind each AI feature; empty means built-in default */}
              <div className="llm-settings-section">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">6</span>
                      <MaterialIcon type="edit_note" />
                      {t('ai_prompts', 'AI Prompts')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'ai_prompts_desc',
                          'Customize the prompts behind each AI feature. Leave a field empty to use the built-in default.'
                      )}
                  </p>

                  {/* overleaf-lab: (a) the three standalone prompts, each with a reset link */}
                  {[
                      {
                          key: 'askAiSystemPrompt',
                          value: askAiSystemPrompt,
                          set: setAskAiSystemPrompt,
                          def: promptDefaults.askAiSystemPrompt,
                          label: t('ask_ai_behavior_prompt', 'Ask AI behavior prompt'),
                          help: t('ask_ai_behavior_prompt_help', 'System prompt for the selection toolbar (Ask AI / paraphrase / rewrite).'),
                      },
                      {
                          key: 'errorPrompt',
                          value: errorPrompt,
                          set: setErrorPrompt,
                          def: promptDefaults.errorPrompt,
                          label: t('error_help_prompt', 'Error help prompt'),
                          help: t('error_help_prompt_help', 'Instructions appended when a user clicks Ask AI about a compile error.'),
                      },
                      {
                          key: 'reviewSystemPrompt',
                          value: reviewSystemPrompt,
                          set: setReviewSystemPrompt,
                          def: promptDefaults.reviewSystemPrompt,
                          label: t('review_system_prompt', 'Review system prompt'),
                          help: t('review_system_prompt_help', 'System prompt for the whole-document compliance review.'),
                      },
                  ].map(field => (
                      <div key={field.key} style={{ marginBottom: '1.25rem' }}>
                          <OLFormGroup controlId={`llm-${field.key}`} style={{ marginBottom: '0.25rem' }}>
                              <OLFormLabel>
                                  {field.label}
                              </OLFormLabel>
                              <OLFormControl
                                  as="textarea"
                                  rows={6}
                                  value={field.value}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                      field.set(e.target.value)
                                  }
                                  style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                              />
                          </OLFormGroup>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <OLFormText style={{ margin: 0 }}>
                                  {field.help}
                              </OLFormText>
                              <OLButton
                                  variant="link"
                                  size="sm"
                                  type="button"
                                  onClick={() => field.set(field.def || '')}
                                  style={{ padding: 0, fontSize: '0.8125rem' }}
                              >
                                  <MaterialIcon type="restart_alt" className="me-1" style={{ fontSize: '1rem' }} />
                                  {t('reset_to_default', 'Reset to default')}
                              </OLButton>
                          </div>
                      </div>
                  ))}

                  {/* overleaf-lab: (b) collapsible Ask AI action templates, one textarea per action */}
                  <div style={{ marginTop: '0.5rem' }}>
                      <OLButton
                          variant="link"
                          size="sm"
                          type="button"
                          onClick={() => setShowActions(v => !v)}
                          style={{ padding: 0, fontSize: '0.875rem' }}
                      >
                          <MaterialIcon type={showActions ? 'expand_less' : 'expand_more'} className="me-1" style={{ fontSize: '1.125rem' }} />
                          {t('ask_ai_action_templates', 'Ask AI action templates')}
                      </OLButton>

                      {showActions && (
                          <div style={{ marginTop: '0.75rem' }}>
                              <OLFormText style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                                  {t(
                                      'ask_ai_action_help',
                                      'Each template runs on the selected text. Use {{selection}} where the selected text should be inserted; if omitted, it is appended.'
                                  )}
                              </OLFormText>
                              {['paraphrase', 'academic', 'concise', 'punchy', 'split', 'join', 'summarize', 'explain', 'mathFix', 'title', 'abstract'].map(key => (
                                  <div key={key} style={{ marginBottom: '1rem' }}>
                                      <OLFormGroup controlId={`llm-action-${key}`} style={{ marginBottom: '0.25rem' }}>
                                          <OLFormLabel>
                                              {t(`ask_ai_action_${key}`, key.charAt(0).toUpperCase() + key.slice(1))}
                                          </OLFormLabel>
                                          <OLFormControl
                                              as="textarea"
                                              rows={4}
                                              value={askAiActionPrompts[key] || ''}
                                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                                                  const value = e.target.value
                                                  setAskAiActionPrompts(prev => ({ ...prev, [key]: value }))
                                              }}
                                              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                                          />
                                      </OLFormGroup>
                                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                          <OLButton
                                              variant="link"
                                              size="sm"
                                              type="button"
                                              onClick={() => {
                                                  const def = promptDefaults.askAiActionPrompts?.[key] || ''
                                                  setAskAiActionPrompts(prev => ({ ...prev, [key]: def }))
                                              }}
                                              style={{ padding: 0, fontSize: '0.8125rem' }}
                                          >
                                              <MaterialIcon type="restart_alt" className="me-1" style={{ fontSize: '1rem' }} />
                                              {t('reset_to_default', 'Reset to default')}
                                          </OLButton>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
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
    )
}
