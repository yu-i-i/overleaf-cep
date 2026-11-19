import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLNotification from './llm-notification'
import OLBadge from '@/shared/components/ol/ol-badge'

// overleaf-lab: BYO (bring-your-own) LLM provider table.
//
// Users manage their own LLM endpoints here: one row per provider with
// type, base URL, encrypted API key, the models it may serve, and an
// optional inline-completion model. Add / edit / delete rows, test the
// connection, and scan the backend for served models.
//
// Backend: /user/llm-providers* (LLMSettingsController). Credentials are
// encrypted at rest (LLM_KEY_SECRET) and never returned to the browser.

type ProviderRow = {
  id: string
  name: string
  providerType: 'openai' | 'anthropic' | 'openaiCompatible'
  baseUrl: string
  hasKey: boolean
  models: string[]
  completionModel: string
  enabled: boolean
  createdAt?: string
}

type Draft = {
  isNew: boolean
  id: string
  name: string
  providerType: 'openai' | 'anthropic' | 'openaiCompatible'
  baseUrl: string
  apiKey: string
  keepKey: boolean
  models: string[]
  completionModel: string
  enabled: boolean
  storedKey: boolean
}

type Notice = { type: 'success' | 'error'; text: string } | null

function defaultDraft(): Draft {
  return {
    isNew: true,
    id: '',
    name: '',
    providerType: 'openaiCompatible',
    baseUrl: '',
    apiKey: '',
    keepKey: false,
    models: [],
    completionModel: '',
    enabled: true,
    storedKey: false,
  }
}

function draftFromRow(row: ProviderRow): Draft {
  return {
    isNew: false,
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl || '',
    apiKey: '',
    keepKey: true,
    models: [...row.models],
    completionModel: row.completionModel || '',
    enabled: row.enabled,
    storedKey: row.hasKey,
  }
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openaiCompatible: 'OpenAI-compatible (Ollama, vLLM, llama.cpp, ...)',
}

export default function LLMSettingsSection({
  compact = false,
}: { compact?: boolean } = {}) {
  // overleaf-lab: when embedded inside the core Account Settings page (reviewer
  // #2) the surrounding page already provides context, so the standalone
  // header is skipped there.

  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [maxProviders, setMaxProviders] = useState(10)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [modelInput, setModelInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [testResult, setTestResult] = useState<Notice>(null)

  const flash = (next: Notice) => {
    setNotice(next)
    if (next) {
      setTimeout(() => setNotice(null), 6000)
    }
  }

  const allowProviders = getMeta('ol-ExposedSettings').llmAllowUserSettings
  const load = useCallback(async () => {
    // サイト接続のみの環境では、個人接続用APIへ403になる要求を送らず、
    // チャットの参照設定だけを利用できるようにします。
    if (!allowProviders) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const response = await getJSON('/user/llm-providers')
      setProviders(Array.isArray(response.providers) ? response.providers : [])
      setMaxProviders(
        typeof response.maxProviders === 'number' ? response.maxProviders : 10
      )
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load your LLM providers')
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [allowProviders])

  useEffect(() => {
    load()
  }, [load])

  const canAdd = allowProviders && providers.length < maxProviders

  const openAdd = () => {
    if (!canAdd) return
    setTestResult(null)
    setModelInput('')
    setDraft(defaultDraft())
  }

  const openEdit = (row: ProviderRow) => {
    setTestResult(null)
    setModelInput('')
    setDraft(draftFromRow(row))
  }

  const closeDraft = () => {
    setDraft(null)
    setModelInput('')
    setTestResult(null)
  }

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(d => (d ? { ...d, [key]: value } : d))
  }

  const addModel = () => {
    const ids = modelInput
      .split(/[\s,]+/)
      .map(m => m.trim())
      .filter(m => m.length > 0)
    setDraft(d => {
      if (!d) return d
      const models = Array.from(new Set([...d.models, ...ids]))
      const completionModel = d.completionModel || models[0] || ''
      return { ...d, models, completionModel }
    })
    setModelInput('')
  }

  const removeModel = (id: string) => {
    setDraft(d => {
      if (!d) return d
      const models = d.models.filter(m => m !== id)
      const completionModel = d.completionModel === id ? '' : d.completionModel
      return { ...d, models, completionModel }
    })
  }

  const validate = (d: Draft): string | null => {
    if (!d.name.trim())
      return t('llm_byo_err_name', 'Please enter a provider name')
    if (d.models.length === 0)
      return t('llm_byo_err_models', 'Please add at least one model')
    if (d.providerType === 'openaiCompatible' && !d.baseUrl.trim()) {
      return t(
        'llm_byo_err_url',
        'A base URL is required for OpenAI-compatible providers'
      )
    }
    if (d.completionModel && !d.models.includes(d.completionModel)) {
      return t(
        'llm_byo_err_completion',
        'The completion model must be one of the listed models'
      )
    }
    return null
  }

  const save = async () => {
    if (!draft) return
    const problem = validate(draft)
    if (problem) {
      flash({ type: 'error', text: problem })
      return
    }
    setBusy('save')
    try {
      const payload = {
        name: draft.name.trim(),
        providerType: draft.providerType,
        baseUrl: draft.baseUrl.trim(),
        models: draft.models,
        completionModel: draft.completionModel,
        enabled: draft.enabled,
      }
      if (draft.isNew) {
        if (draft.apiKey.trim()) {
          payload.apiKey = draft.apiKey.trim()
        }
        await postJSON('/user/llm-providers', { body: payload })
      } else {
        if (draft.apiKey.trim()) {
          payload.apiKey = draft.apiKey.trim()
        } else if (!draft.keepKey) {
          payload.clearApiKey = true
        }
        await postJSON(`/user/llm-providers/${draft.id}`, { body: payload })
      }
      flash({
        type: 'success',
        text: t(
          'llm_byo_saved',
          'Provider saved. It is now available in the editor.'
        ),
      })
      closeDraft()
      await load()
    } catch (err: any) {
      flash({
        type: 'error',
        text:
          err?.data?.message ||
          err?.data?.details ||
          err?.message ||
          t('llm_byo_save_failed', 'Saving failed'),
      })
    } finally {
      setBusy(null)
    }
  }

  const testDraft = async () => {
    if (!draft) return
    setTestResult(null)
    setBusy('test')
    const body: Record<string, unknown> = {
      baseUrl: draft.baseUrl.trim(),
      providerType: draft.providerType,
      models: draft.models,
    }
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim()
    if (!draft.isNew && draft.keepKey) body.rowId = draft.id
    const firstModel = draft.models[0]
    if (firstModel) body.model = firstModel
    try {
      const response = await postJSON('/user/llm-providers/check', { body })
      // overleaf-lab (reviewer #5): the backend auto-detects the working API
      // type — persist it on the row, or switch the draft so the saved type is right.
      let autoTypeText = ''
      if (
        response.detectedProviderType &&
        response.detectedProviderType !== draft.providerType
      ) {
        const detected = response.detectedProviderType as string
        if (draft.id) {
          try {
            await postJSON(`/user/llm-providers/${draft.id}`, {
              body: { providerType: detected },
            })
          } catch {
            /* row update is best-effort; the connection test itself passed */
          }
        } else {
          setDraft(d => (d ? { ...d, providerType: detected } : d))
        }
        autoTypeText = t(
          'llm_byo_auto_type',
          ' — API type auto-set to {{type}}',
          { type: PROVIDER_TYPE_LABELS[detected] || detected }
        )
      }
      setTestResult({
        type: 'success',
        text: `${response.message || t('llm_byo_test_ok', 'Connection successful')}${
          Array.isArray(response.models)
            ? ` — ${response.models.length} model(s) served`
            : ''
        }${autoTypeText}`,
      })
    } catch (err: any) {
      setTestResult({
        type: 'error',
        text:
          err?.data?.message ||
          err?.data?.details ||
          err?.message ||
          t('llm_byo_test_fail', 'Connection failed'),
      })
    } finally {
      setBusy(null)
    }
  }

  const scanModels = async () => {
    if (!draft) return
    setBusy('scan')
    const body: Record<string, unknown> = {
      baseUrl: draft.baseUrl.trim(),
      providerType: draft.providerType,
    }
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim()
    if (!draft.isNew && draft.keepKey) body.rowId = draft.id
    try {
      const response = await postJSON('/user/llm-providers/scan', { body })
      const found: string[] = Array.isArray(response.models)
        ? response.models
        : []
      // overleaf-lab (reviewer #5): auto-detected type wins for the draft too.
      if (
        response.detectedProviderType &&
        response.detectedProviderType !== draft.providerType
      ) {
        const detected = response.detectedProviderType as string
        setDraft(d => (d ? { ...d, providerType: detected } : d))
      }
      if (found.length === 0) {
        flash({
          type: 'error',
          text: t('llm_byo_scan_none', 'The backend reported no models'),
        })
      }
      setDraft(d => {
        if (!d) return d
        const models = Array.from(new Set([...d.models, ...found]))
        const completionModel = d.completionModel || models[0] || ''
        return { ...d, models, completionModel }
      })
      flash({
        type: 'success',
        text: t('llm_byo_scan_ok', 'Models added to the row'),
      })
    } catch (err: any) {
      flash({
        type: 'error',
        text:
          err?.data?.message ||
          err?.data?.details ||
          err?.message ||
          t('llm_byo_scan_failed', 'Model scan failed'),
      })
    } finally {
      setBusy(null)
    }
  }

  const removeProvider = async (row: ProviderRow) => {
    if (
      !window.confirm(
        t(
          'llm_byo_delete_confirm',
          'Delete this provider and its stored API key?'
        )
      )
    ) {
      return
    }
    setBusy(`delete-${row.id}`)
    try {
      await postJSON(`/user/llm-providers/${row.id}/delete`, { body: {} })
      if (draft && draft.id === row.id) {
        closeDraft()
      }
      flash({ type: 'success', text: t('llm_byo_deleted', 'Provider deleted') })
      await load()
    } catch (err: any) {
      flash({
        type: 'error',
        text:
          err?.data?.message ||
          err?.data?.details ||
          err?.message ||
          t('llm_byo_delete_failed', 'Delete failed'),
      })
    } finally {
      setBusy(null)
    }
  }

  const providerTypeLabel = (type: string) =>
    t(
      `llm_byo_type_${type === 'openaiCompatible' ? 'compatible' : type}`,
      PROVIDER_TYPE_LABELS[type] || type
    )

  return (
    <div className="llm-settings llm-buo">
      {!compact && (
        <div className="llm-settings-header">
          <h1 className="llm-settings-header-title">
            {t('llm_byo_title', 'My LLM providers')}
          </h1>
          <p className="llm-settings-header-desc">
            {t(
              'llm_byo_desc',
              'Use your own OpenAI, Anthropic, or any OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp, ...). Keys are encrypted on this server and used only for calls you start.'
            )}
          </p>
        </div>
      )}

      {notice && <OLNotification type={notice.type} content={notice.text} />}

      {loadError && <OLNotification type="error" content={loadError} />}

      {/* Provider table */}
      {!loading && providers.length > 0 && (
        <div className="llm-buo-table-wrap">
          <table className="llm-buo-table">
            <thead>
              <tr>
                <th>{t('llm_byo_col_provider', 'Provider')}</th>
                <th>{t('llm_byo_col_models', 'Models')}</th>
                <th>{t('llm_byo_col_key', 'Key')}</th>
                <th>{t('llm_byo_col_status', 'Status')}</th>
                <th className="llm-buo-actions-col">
                  {t('llm_byo_col_actions', 'Actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {providers.map(row => (
                <tr key={row.id}>
                  <td>
                    <div className="llm-buo-name">{row.name}</div>
                    <div className="llm-buo-sub">
                      {providerTypeLabel(row.providerType)}
                    </div>
                  </td>
                  <td>
                    <div className="llm-buo-models">
                      {row.models.slice(0, 3).map(m => (
                        <OLBadge key={m} variant="secondary">
                          {m}
                        </OLBadge>
                      ))}
                      {row.models.length > 3 && (
                        <span className="llm-buo-more">
                          +{row.models.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{row.hasKey ? '••••' : '—'}</td>
                  <td>
                    {row.enabled
                      ? t('llm_byo_enabled', 'Enabled')
                      : t('llm_byo_disabled', 'Disabled')}
                  </td>
                  <td className="llm-buo-actions">
                    <OLButton
                      variant="tertiary"
                      size="xs"
                      onClick={() => openEdit(row)}
                    >
                      {t('llm_byo_edit', 'Edit')}
                    </OLButton>{' '}
                    <OLButton
                      variant="tertiary"
                      size="xs"
                      disabled={busy !== null}
                      onClick={() => removeProvider(row)}
                    >
                      {t('llm_byo_delete', 'Delete')}
                    </OLButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && providers.length === 0 && !loadError && (
        <div className="llm-buo-empty">
          {t(
            'llm_byo_empty',
            'You have no LLM providers yet. Add one below to chat, complete, and generate with your own keys.'
          )}
        </div>
      )}

      {!loading && canAdd && !draft && (
        <OLButton variant="secondary" onClick={openAdd}>
          {t('llm_byo_add', 'Add provider')}
        </OLButton>
      )}

      <FeatureModelsLane providers={providers} loading={loading} />

      {/* Add / edit panel */}
      {draft && (
        <div className="llm-buo-editor">
          <h2 className="llm-buo-editor-title">
            {draft.isNew
              ? t('llm_byo_add', 'Add provider')
              : t('llm_byo_edit', 'Edit provider')}
          </h2>

          <OLFormGroup>
            <OLFormLabel htmlFor="llm-buo-name">
              {t('llm_byo_name', 'Name')}
            </OLFormLabel>
            <OLFormControl
              id="llm-buo-name"
              type="text"
              value={draft.name}
              maxLength={80}
              placeholder={t('llm_byo_name_placeholder', 'e.g. Ollama (lab)')}
              onChange={e => setField('name', e.target.value)}
            />
          </OLFormGroup>

          <OLFormGroup>
            <OLFormLabel htmlFor="llm-buo-type">
              {t('llm_byo_provider', 'Provider type')}
            </OLFormLabel>
            {/* Native select: OLFormControl (react-bootstrap Form.Control)
                            always renders an <input>, so a select element with
                            <option> children is a void-element violation (dev) /
                            React #137 "got: input" (prod). */}
            <select
              id="llm-buo-type"
              className="form-select"
              value={draft.providerType}
              onChange={e =>
                setField(
                  'providerType',
                  e.target.value as Draft['providerType']
                )
              }
            >
              {(['openai', 'anthropic', 'openaiCompatible'] as const).map(
                type => (
                  <option key={type} value={type}>
                    {providerTypeLabel(type)}
                  </option>
                )
              )}
            </select>
            <OLFormText variant="text">
              {draft.providerType === 'openai'
                ? t(
                    'llm_byo_openai_hint',
                    'Uses api.openai.com unless you set a base URL.'
                  )
                : draft.providerType === 'anthropic'
                  ? t(
                      'llm_byo_anthropic_hint',
                      'Uses api.anthropic.com unless you set a base URL.'
                    )
                  : t(
                      'llm_byo_compatible_hint',
                      'Any server with an OpenAI-style /v1 API: Ollama, vLLM, llama.cpp, OpenRouter, ...'
                    )}
            </OLFormText>
          </OLFormGroup>

          <OLFormGroup>
            <OLFormLabel htmlFor="llm-buo-url">
              {t('llm_byo_baseurl', 'Base URL')}
              {draft.providerType === 'openaiCompatible' && (
                <span className="llm-buo-required">*</span>
              )}
            </OLFormLabel>
            <OLFormControl
              id="llm-buo-url"
              type="url"
              value={draft.baseUrl}
              placeholder={
                draft.providerType === 'anthropic'
                  ? 'https://api.anthropic.com'
                  : 'http://localhost:11434/v1'
              }
              onChange={e => setField('baseUrl', e.target.value)}
            />
          </OLFormGroup>

          <OLFormGroup>
            <OLFormLabel htmlFor="llm-buo-key">
              {t('llm_byo_key', 'API key')}
            </OLFormLabel>
            <OLFormControl
              id="llm-buo-key"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              placeholder={
                draft.storedKey
                  ? t(
                      'llm_byo_key_keep',
                      'Stored key present — leave blank to keep it'
                    )
                  : t(
                      'llm_byo_key_new',
                      'Your API key (left blank for keyless local servers)'
                    )
              }
              onChange={e => setField('apiKey', e.target.value)}
            />
            {!draft.isNew && draft.storedKey && (
              <div className="llm-buo-keytoggle">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.keepKey}
                    onChange={e => setField('keepKey', e.target.checked)}
                  />{' '}
                  {t('llm_byo_key_keep_check', 'Keep the stored key')}
                </label>
              </div>
            )}
          </OLFormGroup>

          <OLFormGroup>
            <OLFormLabel>{t('llm_byo_models', 'Models')}</OLFormLabel>
            <div className="llm-buo-model-editor">
              <OLFormControl
                type="text"
                value={modelInput}
                placeholder={t(
                  'llm_byo_model_placeholder',
                  'qwen3.8:latest, gpt-4o, ...'
                )}
                onChange={e => setModelInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addModel()
                  }
                }}
              />
              <OLButton variant="tertiary" onClick={addModel}>
                {t('llm_byo_model_add', 'Add')}
              </OLButton>
              <OLButton
                variant="tertiary"
                disabled={busy !== null}
                onClick={scanModels}
              >
                {busy === 'scan'
                  ? t('llm_byo_scanning', 'Scanning...')
                  : t('llm_byo_scan', 'Scan backend for models')}
              </OLButton>
            </div>
            {draft.models.length > 0 && (
              <div className="llm-buo-model-chips">
                {draft.models.map(m => (
                  <span key={m} className="llm-buo-chip">
                    {m}
                    <button
                      type="button"
                      className="llm-buo-chip-x"
                      aria-label={t('llm_byo_model_remove', 'Remove model')}
                      onClick={() => removeModel(m)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {draft.models.length > 0 && (
              <OLFormText variant="text">
                {t(
                  'llm_byo_models_note',
                  'The first model is the default for this provider.'
                )}
              </OLFormText>
            )}
          </OLFormGroup>

          <div className="llm-buo-enabled">
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={e => setField('enabled', e.target.checked)}
              />{' '}
              {t('llm_byo_enabled_label', 'Enabled (visible in the editor)')}
            </label>
          </div>

          {testResult && (
            <OLNotification type={testResult.type} content={testResult.text} />
          )}

          <div className="llm-buo-editor-actions">
            <OLButton variant="primary" disabled={busy !== null} onClick={save}>
              {busy === 'save'
                ? t('llm_byo_saving', 'Saving...')
                : t('llm_byo_save', 'Save provider')}
            </OLButton>{' '}
            <OLButton
              variant="tertiary"
              disabled={busy !== null}
              onClick={testDraft}
            >
              {busy === 'test'
                ? t('llm_byo_testing', 'Testing...')
                : t('llm_byo_test', 'Test connection')}
            </OLButton>{' '}
            <OLButton variant="tertiary" onClick={closeDraft}>
              {t('llm_byo_cancel', 'Cancel')}
            </OLButton>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 機能別 AI 選択欄（2026-11-12 の運用者要望） -----------------------------
//
// AI 機能（AI Assistant チャット / Ask AI / インライン補完 / 文書生成 /
// コンパイル修正 / 準拠レビュー）ごとに、どの BYO 行のモデルを使うかを選ぶ欄です。
// 保存先は User.llmFeatureModels（GET/POST /user/llm-feature-models）。値は
// 共通モデル選択と同じ ref 書式（'u:<行ID>:<モデル>'）で、空欄の機能は
// File メニューの共有選択 → サーバー既定の従来チェーンに従います。
// リクエスト側でモデルを明示選択した場合は、そちらが常に優先されます。
// （翻訳は専用の接続欄を持つためここには含めません）

type FeatureModelsDraft = {
  chat: string
  ask: string
  completion: string
  generate: string
  compileFix: string
  compliance: string
}

const FEATURE_DEFS: Array<{
  key: keyof FeatureModelsDraft
  label: string
  desc: string
}> = [
  {
    key: 'chat',
    label: 'AI Assistant（チャットレール）',
    desc: '左レールの会話パネルで質問や添削をするとき使う AI です。',
  },
  {
    key: 'ask',
    label: 'Ask AI（選択範囲の相談）',
    desc: 'エディターで文字列を選択したときの「Ask AI」で使う AI です。',
  },
  {
    key: 'completion',
    label: 'インライン補完',
    desc: '入力中に続きのテキストを提案するとき使う AI です（軽量モデル推奨）。',
  },
  {
    key: 'generate',
    label: '文書生成',
    desc: 'セクションやスニペットの自動生成で使う AI です。',
  },
  {
    key: 'compileFix',
    label: 'コンパイル修正提案',
    desc: 'コンパイルエラーの修正候補を作るときの AI です。',
  },
  {
    key: 'compliance',
    label: '準拠・添削レビュー',
    desc: 'ドキュメントの準拠レビューで使う AI です。',
  },
]

function FeatureModelsLane({
  providers,
  loading,
}: {
  providers: ProviderRow[]
  loading: boolean
}) {
  const [draft, setDraft] = useState<FeatureModelsDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  // AI Assistant チャットのプロジェクト TeX 参照設定（既定 auto・2026-11-13）。
  // チャット画面にはスイッチを置かず、この設定画面で管理する。
  // mode: auto = 質問に合う抜粋 / full = 全体読み込み（全体チェック用）/ off。
  const [contextMode, setContextMode] = useState('auto')
  // コンテキスト長予算（文字数）。空欄/0 = 組み込み既定（auto 12,000 / full 60,000）。
  const [contextBudget, setContextBudget] = useState('')

  // 保存済みの機能別選択をマウント時に読み込みます。
  useEffect(() => {
    let active = true
    const loadFeatureModels = async () => {
      try {
        const response = await getJSON('/user/llm-feature-models')
        if (!active || !response.ok) return
        const models = response.models || {}
        setDraft({
          chat: models.chat || '',
          ask: models.ask || '',
          completion: models.completion || '',
          generate: models.generate || '',
          compileFix: models.compileFix || '',
          compliance: models.compliance || '',
        })
        setContextMode(
          ['auto', 'full', 'off'].includes(response.chatContextMode)
            ? response.chatContextMode
            : response.chatAutoContext === false
              ? 'off'
              : 'auto'
        )
        setContextBudget(
          response.chatContextBudget ? String(response.chatContextBudget) : ''
        )
      } catch {
        // 読み取り失敗は AI 機能自体の障害ではないため、欄は空欄のまま進めます。
      }
    }
    loadFeatureModels()
    return () => {
      active = false
    }
  }, [])

  if (loading || !draft) return null

  // 候補は有効な BYO 行のモデル一覧（翻訳と違い Anthropic 行も使えます）。
  const usableRows = providers.filter(row => row.enabled)

  const refLabel = (value: string) => {
    if (!value) return ''
    const match = /^u:([0-9a-f]{8}):(.+)$/.exec(value)
    if (!match) return value
    const row = providers.find(candidate => candidate.id === match[1])
    return row ? `${row.name} · ${match[2]}` : value
  }

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const budget = parseInt(contextBudget, 10)
      await postJSON('/user/llm-feature-models', {
        body: {
          ...draft,
          chatContextMode: contextMode,
          chatContextBudget: Number.isFinite(budget) ? budget : 0,
        },
      })
      setNotice({
        type: 'success',
        text: 'チャット設定を保存しました。次のリクエストから反映されます。',
      })
    } catch (err: any) {
      setNotice({
        type: 'error',
        text:
          err?.data?.message ||
          err?.data?.details ||
          err?.message ||
          '保存できませんでした。',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="llm-buo-editor" style={{ marginTop: 16 }}>
      <h2 className="llm-buo-editor-title">チャットのモデル・参照設定</h2>
      <OLFormText variant="text">
        チャットに使うモデルと、プロジェクトの参照範囲を設定します。
        「共有選択に従う」ではレールのモデル選択を使います。
      </OLFormText>

      <OLFormGroup>
        <OLFormLabel htmlFor="llm-chat-context-auto">
          AI Assistant チャットのプロジェクト TeX 参照
        </OLFormLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* 3 モード選択（2026-11-13。auto は質問意図の自動判定込み）。 */}
          {[
            {
              value: 'auto',
              label: '自動（質問を見て全体か該当箇所かを判断・推奨）',
            },
            {
              value: 'full',
              label: '常に全体を読み込む（毎回プロジェクト全体を添える）',
            },
            { value: 'off', label: '参照しない' },
          ].map(option => (
            <label
              key={option.value}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="llm-chat-context-mode"
                value={option.value}
                checked={contextMode === option.value}
                onChange={() => {
                  setContextMode(option.value)
                  setNotice(null)
                }}
              />{' '}
              {option.label}
            </label>
          ))}
        </div>
        <OLFormText variant="text">
          「自動」は質問文を見て判断します。「全体・校正・表記ゆれ」などの
          質問ならプロジェクト全体の全文を、ファイル名（例: methods.tex）や
          セクション名（例: 考察・method）に触れる質問はその箇所を重点的に、
          それ以外は質問に合う箇所の抜粋を、毎回自動で添えます。
          「常に全体」は質問にかかわらず毎回全文を添えます。回答の下に 「参照:
          …」と使用ファイルを表示します。全体読み込みはモデルの
          コンテキスト上限（plamo 系は入出力計 32,768 トークン）に収まるよう
          予算を調整してください。
        </OLFormText>
      </OLFormGroup>

      <OLFormGroup>
        <OLFormLabel htmlFor="llm-chat-context-budget">
          参照コンテキスト長（文字数）
        </OLFormLabel>
        <input
          id="llm-chat-context-budget"
          className="form-control"
          type="number"
          min={2000}
          max={200000}
          step={1000}
          value={contextBudget}
          onChange={e => {
            setContextBudget(e.target.value)
            setNotice(null)
          }}
          placeholder="空欄で既定（自動参照: 12,000 字 / 全体読み込み: 60,000 字）"
        />
        <OLFormText variant="text">
          2,000〜200,000 字。目安として日本語 1 字 ≒ 0.5〜1 トークン。
          全体読み込みで予算を超えたファイルは「省略したファイル」として明示されます。
        </OLFormText>
      </OLFormGroup>

      {FEATURE_DEFS.filter(feature => feature.key === 'chat').map(feature => (
        <OLFormGroup key={feature.key}>
          <OLFormLabel htmlFor={`llm-feature-${feature.key}`}>
            {feature.label}
          </OLFormLabel>
          <select
            id={`llm-feature-${feature.key}`}
            className="form-select"
            value={draft[feature.key]}
            onChange={e => {
              setDraft(current =>
                current
                  ? { ...current, [feature.key]: e.target.value }
                  : current
              )
              setNotice(null)
            }}
          >
            <option value="">
              共有選択に従う（
              {refLabel(draft[feature.key]) || '現在: 共有設定のまま'}）
            </option>
            {usableRows.map(row => (
              <optgroup key={row.id} label={row.name}>
                {row.models.map(model => (
                  <option
                    key={`${row.id}:${model}`}
                    value={`u:${row.id}:${model}`}
                  >
                    {model}
                  </option>
                ))}
              </optgroup>
            ))}
            {draft[feature.key] &&
              !usableRows.some(row =>
                draft[feature.key].startsWith(`u:${row.id}:`)
              ) && (
                // 保存後に削除/無効化された行や、BYO 外の値（サイト側モデル名）の表示用。
                <option value={draft[feature.key]}>
                  （現在の設定:{' '}
                  {refLabel(draft[feature.key]) || draft[feature.key]}）
                </option>
              )}
          </select>
          <OLFormText variant="text">{feature.desc}</OLFormText>
        </OLFormGroup>
      ))}

      {usableRows.length === 0 && (
        <OLFormText variant="text">
          候補が表示されない場合、上に LLM 行（接続先）を追加してください。
        </OLFormText>
      )}

      {notice && <OLNotification type={notice.type} content={notice.text} />}

      <OLButton variant="primary" disabled={busy} onClick={save}>
        {busy ? '保存中…' : 'チャット設定を保存'}
      </OLButton>
    </div>
  )
}
