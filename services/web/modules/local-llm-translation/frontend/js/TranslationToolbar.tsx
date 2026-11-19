/**
 * エディタツールバーの「英訳」ボタンと翻訳パネル（ダイアログ）です。
 *
 * CE の拡張点 sourceEditorToolbarComponents（settings.defaults.js）から
 * LaTeX 文書エディタのツールバーへ登録されます。パネルの流れは次のとおりです。
 *
 * 1. 開いた時点でモデル一覧とプロジェクト設定（用語集）を読み込む
 * 2. 「確認して翻訳」で原文のスナップショットを取り、Overleaf API 経由で翻訳を開始
 * 3. SSE の進捗・訳片をプレビューへ反映する
 * 4. 完了後、全文翻訳は英語版 .en.tex として保存、選択範囲翻訳は原文へ適用
 *
 * 翻訳中に原文が編集された場合（canApply が false）、適用・保存を止めます。
 * ブラウザーは Overleaf の同一オリジン API だけ呼び出し、CSRF トークンを付けます。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { language } from '@codemirror/language'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useProjectContext } from '@/shared/context/project-context'
import { getJSON, postJSON, putJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import ConnectionSettings from './ConnectionSettings'
import {
  maskPartialMarkers,
  readTranslationStream,
  type TranslationReply,
  type TranslationStreamEvent,
} from './translation-stream'

// ---- 翻訳 API が返すデータの型定義 -----------------------------------------

type Model = { id: string; owned_by?: string }
type GlossaryTerm = { source: string; target: string }
type ProjectSettings = {
  terms: GlossaryTerm[]
  model: string | null
  context: string
  endpoint_id?: string | null
  prompt_instructions?: string
  default_prompt_instructions?: string
}
// 翻訳対象の指定方法（選択範囲 / 現在のファイル全体）。
type Target = 'selection' | 'file'
// 翻訳開始時の文書状態の照合用スナップショット。
// 翻訳完了時に現在の内容と違う場合、結果の適用・保存を止めます。
type Snapshot = {
  text: string
  document: string
  sourceDocId: string
  from: number
  to: number
  target: Target
}

/** API エラーから日本語のメッセージを取り出します（detail 優先）。 */
function getErrorMessage(error: unknown): string {
  const candidate = error as { data?: { detail?: string }; message?: string }
  return candidate?.data?.detail || candidate?.message || '処理に失敗しました。'
}

async function streamTranslation(
  path: string,
  body: { text: string; model: string },
  signal: AbortSignal,
  onEvent: (event: TranslationStreamEvent) => void
): Promise<TranslationReply> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Csrf-Token': getMeta('ol-csrfToken'),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(
      payload.detail || `翻訳サービスが HTTP ${response.status} を返しました。`
    )
  }
  if (!response.body) throw new Error('ストリーミング応答を読み取れません。')

  return readTranslationStream(response.body, onEvent)
}

/**
 * 「英訳」ボタンと翻訳パネルの本体コンポーネントです。
 * LaTeX 文書以外のタブではボタンを表示しません（isLatex 判定）。
 */
export default function TranslationToolbar() {
  const state = useCodeMirrorStateContext()
  const view = useCodeMirrorViewContext()
  const editorManager = useEditorManagerContext()
  const permissions = usePermissionsContext()
  const { pathInFolder, dirname, findEntityByPath } = useFileTreePathContext()
  const { projectId, project, updateProject } = useProjectContext()
  // ---- パネルの表示状態・翻訳結果などの状態値 ------------------------------
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<Target>('file')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [context, setContext] = useState('')
  const [endpointId, setEndpointId] = useState<string | null>(null)
  const [promptInstructions, setPromptInstructions] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const modelsRequestRef = useRef(0)
  const [selectedModel, setSelectedModel] = useState('')
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [completedPreview, setCompletedPreview] = useState('')
  const [partialPreview, setPartialPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<TranslationReply | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const translationAbortRef = useRef<AbortController | null>(null)

  const projectPath = `/project/${projectId}/local-llm`
  const isLatex = state.facet(language)?.name === 'latex'
  const selection = state.selection.main
  const hasSelection = !selection.empty
  // 結果を適用・保存できる条件: 翻訳後に対象ドキュメントが一度も編集されていないこと。
  const canApply = Boolean(
    permissions.write &&
    !busy &&
    (result || completedPreview) &&
    snapshot &&
    editorManager.getCurrentDocumentId() === snapshot.sourceDocId &&
    view.state.doc.toString() === snapshot.document
  )

  const loadModels = useCallback(
    async (endpoint: string | null, preferred = '') => {
      const request = ++modelsRequestRef.current
      setLoading(true)
      setError('')
      try {
        const suffix = endpoint
          ? `?endpoint_id=${encodeURIComponent(endpoint)}`
          : ''
        const response = await getJSON<{ data: Model[] }>(
          `/local-llm/models${suffix}`
        )
        if (request !== modelsRequestRef.current) return
        setModels(response.data)
        setSelectedModel((current) => {
          if (response.data.some((model) => model.id === preferred))
            return preferred
          if (response.data.some((model) => model.id === current))
            return current
          return response.data[0]?.id || ''
        })
      } catch (failure) {
        if (request !== modelsRequestRef.current) return
        setModels([])
        setSelectedModel('')
        setError(getErrorMessage(failure))
      } finally {
        if (request === modelsRequestRef.current) setLoading(false)
      }
    },
    []
  )

  const loadPanel = useCallback(async () => {
    setOpen(true)
    setError('')
    setNotice('')
    setResult(null)
    setCompletedPreview('')
    setPartialPreview('')
    setConsented(false)
    setTarget(hasSelection ? 'selection' : 'file')
    setSnapshot(null)
    setLoading(true)
    try {
      // プロジェクトの選択先を先に読み、その接続先のモデルだけを表示します。
      const loaded = await getJSON<ProjectSettings>(`${projectPath}/settings`)
      setTerms(loaded.terms || [])
      setContext(loaded.context || '')
      setEndpointId(loaded.endpoint_id || null)
      setPromptInstructions(loaded.prompt_instructions || '')
      setDefaultPrompt(loaded.default_prompt_instructions || '')
      await loadModels(loaded.endpoint_id || null, loaded.model || '')
    } catch (failure) {
      setLoading(false)
      setError(getErrorMessage(failure))
    }
  }, [hasSelection, projectPath, loadModels])

  // Escape キーでパネルを閉じられるようにします（翻訳中・保存中は閉じません）。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !saving) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, open, saving])

  // コンポーネントがアンマウントされたら、未完了の翻訳ストリームを必ず止めます。
  useEffect(
    () => () => {
      translationAbortRef.current?.abort()
    },
    []
  )

  // 本文を書き換える操作を含むため、サーバーと同じ書き込み権限を要求します。
  if (!isLatex || !permissions.write) return null

  /** 用語集・モデル・文体メモをプロジェクト設定として保存します。 */
  const saveSettings = async () => {
    setSaving(true)
    setError('')
    try {
      const updated = await putJSON<ProjectSettings>(
        `${projectPath}/settings`,
        {
          body: {
            terms: terms.filter(
              (term) => term.source.trim() && term.target.trim()
            ),
            model: selectedModel || null,
            context,
            endpoint_id: endpointId,
            prompt_instructions: promptInstructions,
          },
        }
      )
      setTerms(updated.terms || [])
      setNotice('翻訳設定を保存しました。')
      return true
    } catch (saveError) {
      setError(getErrorMessage(saveError))
      return false
    } finally {
      setSaving(false)
    }
  }

  /** 翻訳開始時点の原文・選択位置・対象ドキュメント ID を記録します。 */
  const captureSnapshot = (): Snapshot => {
    const current = view.state
    const selected = current.selection.main
    const currentDocument = current.doc.toString()
    const sourceDocId = editorManager.getCurrentDocumentId() || ''
    if (target === 'selection' && !selected.empty) {
      return {
        text: current.doc.sliceString(selected.from, selected.to),
        document: currentDocument,
        sourceDocId,
        from: selected.from,
        to: selected.to,
        target,
      }
    }
    return {
      text: currentDocument,
      document: currentDocument,
      sourceDocId,
      from: 0,
      to: current.doc.length,
      target: 'file',
    }
  }

  /** 翻訳開始の入口。スナップショット採取 → 設定保存 → SSE 翻訳の順に進めます。 */
  const runTranslation = async () => {
    const captured = captureSnapshot()
    if (!captured.text.trim()) {
      setError('翻訳する内容がありません。')
      return
    }
    if (!captured.sourceDocId) {
      setError('翻訳元の .tex ファイルを特定できません。')
      return
    }
    if (!selectedModel) {
      setError('利用可能なモデルを取得し、使用モデルを選択してください。')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    setResult(null)
    setSnapshot(captured)
    setProgress('用語集と文書メモを保存しています。')
    setCompletedPreview('')
    setPartialPreview('')
    const abortController = new AbortController()
    translationAbortRef.current = abortController
    try {
      const saved = await saveSettings()
      if (abortController.signal.aborted) {
        setNotice('翻訳を停止しました。途中の結果は適用されていません。')
        return
      }
      if (!saved) return
      setProgress('ローカルLLMに接続しています。')
      const reply = await streamTranslation(
        `${projectPath}/translate`,
        { text: captured.text, model: selectedModel },
        abortController.signal,
        (event) => {
          if (event.type === 'progress') {
            setProgress(event.message)
            if (event.phase === 'retrying') setPartialPreview('')
          }
          if (event.type === 'delta') {
            setPartialPreview((current) => current + event.text)
          }
          if (event.type === 'chunk_complete') {
            setCompletedPreview((current) => current + event.text)
            setPartialPreview('')
          }
        }
      )
      if (abortController.signal.aborted) return
      setResult(reply)
      setProgress('LaTeX構造の検証が完了しました。')
      if (reply.failed_chunks && reply.failed_chunks.length > 0) {
        setNotice(
          `${reply.chunks} チャンク中 ${reply.failed_chunks.length} 件が翻訳に失敗したため原文を保持しています（第 ${reply.failed_chunks.join('・')} チャンク）。未翻訳部分を直してから、必要なら再実行してください。`
        )
      } else {
        setNotice(
          `${reply.chunks} チャンクを翻訳しました。内容を確認して英語版として保存してください。`
        )
      }
    } catch (translationError) {
      // 停止・失敗でも、これまでに確定済みのプレビューは消しません（再実行の材料に残す）。
      if (abortController.signal.aborted) {
        setNotice(
          '翻訳を停止しました。これまでに確定したチャンクはプレビューに残っています。'
        )
      } else {
        setError(getErrorMessage(translationError))
      }
    } finally {
      if (translationAbortRef.current === abortController) {
        translationAbortRef.current = null
      }
      setBusy(false)
      setProgress('')
    }
  }

  /** 翻訳停止。fetch を中断し、Overleaf 経由で LLM まで停止要求を伝えます。 */
  const stopTranslation = () => {
    if (!translationAbortRef.current) return
    setNotice('LLMへの停止要求を送信しています。')
    translationAbortRef.current.abort()
  }

  /** 選択範囲翻訳の結果を原文の該当範囲へ置き換えます（確認ダイアログ付き）。 */
  const applyResult = () => {
    if (!result || !snapshot) return
    if (!canApply) {
      setError(
        '翻訳中に原文が変更されたか、別のファイルへ移動しました。現在の文書で翻訳し直してください。'
      )
      return
    }
    if (
      snapshot.target === 'selection' &&
      !window.confirm(
        '選択範囲を翻訳結果で置き換えます。日本語原文のこの範囲は変更されます。続けますか？'
      )
    ) {
      return
    }
    view.dispatch({
      changes: { from: snapshot.from, to: snapshot.to, insert: result.text },
      selection: { anchor: snapshot.from + result.text.length },
    })
    setNotice('翻訳をエディタへ適用しました。')
    setResult(null)
    setSnapshot(null)
  }

  /**
   * 翻訳結果を同じフォルダーの英語版 .en.tex として保存します。
   * setAsMainDocument が true の場合、保存後にメイン文書設定とタブ切替も行います。
   * 日本語原文は変更しません。停止・失敗時は確定済みチャンクだけを草稿にできます。
   */
  const saveEnglishDocument = async (setAsMainDocument: boolean) => {
    // 受信途中の delta は含めず、検証済みの最終結果か確定済みチャンクだけを保存する。
    const content = result?.text ?? completedPreview
    const isDraft = !result
    if (busy || saving || !content || !snapshot || snapshot.target !== 'file')
      return
    // 未完了の文書をメイン文書へ切り替えない。草稿は別ファイルとして退避する。
    if (isDraft && setAsMainDocument) return
    if (!canApply) {
      setError(
        '翻訳中に原文が変更されたか、別のファイルへ移動しました。現在の文書で翻訳し直してください。'
      )
      return
    }

    if (
      isDraft &&
      !window.confirm(
        '翻訳は完走していません。確定済みチャンクだけを草稿として保存します。文書全体の LaTeX 検証は済んでいないため、保存後に内容を確認してください。続けますか？'
      )
    )
      return

    const sourcePath = pathInFolder(snapshot.sourceDocId)
    const sourceName = sourcePath?.split('/').pop()
    if (!sourceName || !sourceName.toLowerCase().endsWith('.tex')) {
      setError('翻訳元の .tex ファイル名を特定できません。')
      return
    }
    if (sourceName.toLowerCase().endsWith('.en.tex')) {
      setError(
        '英語版ファイルから別の英語版は作成できません。日本語原文のファイルを開いてください。'
      )
      return
    }

    const parentPath = dirname(snapshot.sourceDocId) || ''
    const parent = findEntityByPath(parentPath)
    if (!parent || parent.type !== 'folder') {
      setError('翻訳元ファイルの保存先フォルダーを特定できません。')
      return
    }

    const englishName = `${sourceName.slice(0, -4)}.en.tex`
    const englishPath = [parentPath, englishName].filter(Boolean).join('/')
    const existing = findEntityByPath(englishPath)
    if (existing && existing.type !== 'doc') {
      setError(
        `${englishPath} という同名のファイルまたはフォルダーがあります。名前を変更してください。`
      )
      return
    }

    const overwrite = existing?.type === 'doc'
    if (
      overwrite &&
      !window.confirm(
        `${englishPath} は既にあります。翻訳結果で英語版の内容を上書きしますか？日本語原文は変更されません。`
      )
    ) {
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await putJSON<{ doc: { _id: string; name: string } }>(
        `${projectPath}/english-document`,
        {
          body: {
            source_doc_id: snapshot.sourceDocId,
            parent_folder_id: parent.entity._id,
            name: englishName,
            content,
            overwrite,
          },
        }
      )
      setResult(null)
      setSnapshot(null)
      setCompletedPreview('')
      setPartialPreview('')
      if (setAsMainDocument) {
        try {
          await postJSON(`/project/${projectId}/settings`, {
            body: { rootDocId: saved.doc._id },
          })
          if (project) updateProject({ rootDocId: saved.doc._id })
          await editorManager.openDoc(saved.doc)
          setNotice(
            `${englishPath} を保存してメイン文書に設定し、英語版タブを開きました。「コンパイル」を押すと英語版のPDFを生成します。日本語原文は変更していません。`
          )
        } catch (settingsError) {
          setError(
            `英語版は ${englishPath} に保存されましたが、メイン文書またはエディタタブの切り替えに失敗しました。ファイルを右クリックして「メイン文書に設定」を選んでください。${getErrorMessage(settingsError)}`
          )
        }
      } else {
        setNotice(
          isDraft
            ? `${englishPath} に訳済み部分を草稿として保存しました。文書全体の LaTeX 検証は未実施です。`
            : `${englishPath} に英語版を${overwrite ? '上書き保存' : '作成'}しました。日本語原文は変更していません。`
        )
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  /** コピーは退避専用。原文が変わった後でも確定済みの内容を取り出せる。 */
  const copyCompletedPreview = async () => {
    if (busy || !completedPreview) return
    setError('')
    try {
      await navigator.clipboard.writeText(completedPreview)
      setNotice('訳済み部分をコピーしました。プレビューは残っています。')
    } catch {
      setError('コピーに失敗しました。プレビューを選択してコピーしてください。')
    }
  }

  const updateTerm = (
    index: number,
    field: keyof GlossaryTerm,
    value: string
  ) => {
    setTerms((current) =>
      current.map((term, termIndex) =>
        termIndex === index ? { ...term, [field]: value } : term
      )
    )
  }

  return (
    <>
      {/* LaTeX ツールバーに表示する「英訳」ボタン。クリックでパネルを開きます。 */}
      <button
        type="button"
        className="ol-cm-toolbar-button"
        title="日本語から英語へ翻訳"
        aria-label="日本語から英語へ翻訳"
        onClick={loadPanel}
      >
        英訳
      </button>

      {/* 翻訳パネル（モーダル）。背景クリックでは閉じますが、翻訳中・保存中は無視します。 */}
      {open && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy && !saving) {
              setOpen(false)
            }
          }}
          style={overlayStyle}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-llm-translation-title"
            style={dialogStyle}
          >
            <header style={headerStyle}>
              <div>
                <h2
                  id="local-llm-translation-title"
                  style={{ margin: 0, fontSize: 20 }}
                >
                  日本語から英語へ翻訳
                </h2>
                <div style={{ color: '#666', marginTop: 4 }}>
                  LLM: {selectedModel || '未選択'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || saving}
                onClick={() => setOpen(false)}
              >
                閉じる
              </button>
            </header>

            <div style={bodyStyle}>
              <ConnectionSettings
                endpointId={endpointId}
                disabled={busy || saving}
                onSelect={(id) => {
                  setEndpointId(id)
                  setResult(null)
                  setSnapshot(null)
                  setCompletedPreview('')
                  setPartialPreview('')
                  setSelectedModel('')
                  void loadModels(id)
                }}
                onChanged={() => {
                  void loadModels(endpointId, selectedModel)
                }}
              />
              <label style={fieldStyle}>
                使用モデル
                <select
                  className="form-control"
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  disabled={!models.length || busy || loading}
                >
                  {selectedModel &&
                    !models.some((model) => model.id === selectedModel) && (
                      <option value={selectedModel}>
                        {selectedModel} (現在の設定)
                      </option>
                    )}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset style={{ border: 0, padding: 0, margin: '4px 0 14px' }}>
                <legend style={{ fontWeight: 600, marginBottom: 6 }}>
                  翻訳対象
                </legend>
                <label style={{ marginRight: 20 }}>
                  <input
                    type="radio"
                    name="local-llm-target"
                    checked={target === 'selection'}
                    disabled={!hasSelection || busy}
                    onChange={() => setTarget('selection')}
                  />{' '}
                  選択範囲
                </label>
                <label>
                  <input
                    type="radio"
                    name="local-llm-target"
                    checked={target === 'file'}
                    disabled={busy}
                    onChange={() => setTarget('file')}
                  />{' '}
                  現在の .tex ファイル
                </label>
              </fieldset>

              <details style={{ marginBottom: 14 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                  用語集と文書コンテキスト
                </summary>
                <p style={{ color: '#666', margin: '8px 0' }}>
                  用語集と概要はプロジェクト単位で保存し、翻訳の各チャンクに渡します。
                </p>
                {terms.map((term, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr auto',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <input
                      className="form-control"
                      aria-label="日本語の用語"
                      placeholder="日本語"
                      value={term.source}
                      onChange={(event) =>
                        updateTerm(index, 'source', event.target.value)
                      }
                    />
                    <input
                      className="form-control"
                      aria-label="指定する英語訳"
                      placeholder="English"
                      value={term.target}
                      onChange={(event) =>
                        updateTerm(index, 'target', event.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label="用語を削除"
                      onClick={() =>
                        setTerms((current) =>
                          current.filter((_, i) => i !== index)
                        )
                      }
                    >
                      削除
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setTerms((current) => [
                      ...current,
                      { source: '', target: '' },
                    ])
                  }
                >
                  用語を追加
                </button>
                <label style={{ ...fieldStyle, marginTop: 12 }}>
                  論文の概要・文体メモ
                  <textarea
                    className="form-control"
                    rows={3}
                    maxLength={4000}
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                    placeholder="例: 分散システムを対象とする実証研究。簡潔なacademic writingを使う。"
                  />
                </label>
                <label style={fieldStyle}>
                  翻訳の文体指示
                  <textarea
                    className="form-control"
                    rows={3}
                    maxLength={4000}
                    value={promptInstructions}
                    placeholder={defaultPrompt}
                    onChange={(event) =>
                      setPromptInstructions(event.target.value)
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving || busy}
                  onClick={() => setPromptInstructions('')}
                >
                  文体指示を既定に戻す
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving || busy}
                  onClick={saveSettings}
                >
                  {saving ? '保存中…' : '翻訳設定を保存'}
                </button>
              </details>

              <label
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  margin: '8px 0 14px',
                }}
              >
                <input
                  type="checkbox"
                  checked={consented}
                  disabled={busy}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                <span>
                  選択した内容を設定済みのローカルLLMへ送信することを確認しました。翻訳結果はプレビューで確認してから保存します。
                </span>
              </label>

              {snapshot && (
                <div style={previewGridStyle}>
                  <div>
                    <strong>日本語原文</strong>
                    <pre style={previewStyle}>{snapshot.text}</pre>
                  </div>
                  <div>
                    <strong>英訳プレビュー</strong>
                    <pre style={previewStyle}>
                      {result?.text || (
                        <>
                          {completedPreview}
                          {/* 生成途中の訳片。保護マーカーは「…」に伏せて仮表示します。 */}
                          {busy && partialPreview && (
                            <span style={partialPreviewStyle}>
                              {maskPartialMarkers(partialPreview)}
                            </span>
                          )}
                          {busy && !partialPreview && !completedPreview && (
                            <span style={partialPreviewStyle}>
                              {progress || '翻訳を準備しています。'}
                            </span>
                          )}
                          {!busy &&
                            !completedPreview &&
                            '翻訳結果はここに表示されます。'}
                        </>
                      )}
                    </pre>
                    {busy && (
                      <div
                        role="status"
                        aria-live="polite"
                        style={progressStyle}
                      >
                        {progress}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div role="alert" className="alert alert-danger">
                  {error}
                </div>
              )}
              {notice && (
                <div role="status" className="alert alert-info">
                  {notice}
                </div>
              )}
            </div>

            <footer style={footerStyle}>
              {busy ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={stopTranslation}
                >
                  翻訳を停止
                </button>
              ) : result ? (
                snapshot?.target === 'file' ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canApply || saving}
                      title={
                        canApply
                          ? undefined
                          : '翻訳中に文書が変更されました。翻訳し直してください。'
                      }
                      onClick={() => saveEnglishDocument(false)}
                    >
                      英語版 .tex として保存
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!canApply || saving}
                      title={
                        canApply
                          ? undefined
                          : '翻訳中に文書が変更されました。翻訳し直してください。'
                      }
                      onClick={() => saveEnglishDocument(true)}
                    >
                      {saving ? '保存中…' : '保存して英語版をメイン文書に設定'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canApply || saving}
                    title={
                      canApply
                        ? undefined
                        : '翻訳中に文書が変更されました。翻訳し直してください。'
                    }
                    onClick={applyResult}
                  >
                    選択範囲を原文に適用
                  </button>
                )
              ) : (
                <>
                  {completedPreview && snapshot && (
                    <>
                      {snapshot.target === 'file' && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!canApply || saving}
                          title={
                            canApply
                              ? undefined
                              : '原文または権限が変わりました。現在の文書で翻訳し直してください。'
                          }
                          onClick={() => saveEnglishDocument(false)}
                        >
                          {saving
                            ? '保存中…'
                            : '訳済み部分だけ英語版 .tex に保存（草稿）'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={saving}
                        onClick={copyCompletedPreview}
                      >
                        訳済み部分をコピー
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!consented || saving || loading || !selectedModel}
                    onClick={runTranslation}
                  >
                    確認して翻訳
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  )
}

// ---- パネルの装飾用スタイル（インライン style 用の定数群） ------------------
// Overleaf 本体の SCSS に依存せず、ツールバー登録でも崩れないよう固定値で持っています。

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  background: 'rgba(0, 0, 0, 0.45)',
}

const dialogStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 'min(1100px, 96vw)',
  maxHeight: '92vh',
  background: '#fff',
  color: '#222',
  borderRadius: 8,
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 20,
  padding: '16px 20px',
  borderBottom: '1px solid #ddd',
}

const bodyStyle: CSSProperties = {
  padding: 20,
  overflow: 'auto',
}

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 20px',
  borderTop: '1px solid #ddd',
}

const fieldStyle: CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 14,
}

const previewGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 16,
  margin: '10px 0 16px',
}

const previewStyle: CSSProperties = {
  minHeight: 160,
  maxHeight: 300,
  overflow: 'auto',
  padding: 12,
  margin: '6px 0 0',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  background: '#f6f6f6',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 13,
}

const partialPreviewStyle: CSSProperties = {
  color: '#858585',
  opacity: 0.75,
  fontStyle: 'italic',
}

const progressStyle: CSSProperties = {
  minHeight: 20,
  marginTop: 5,
  color: '#858585',
  fontSize: 12,
}
