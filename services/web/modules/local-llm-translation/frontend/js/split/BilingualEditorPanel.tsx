/**
 * 公式の追加パネルに、別の .tex を開いて比較・編集する。
 * 原文・PDF・MCP の既存経路は維持し、保存は読み込み時の版に対してだけ行う。
 * 他の編集者や MCP が先に更新した場合は 409 を表示し、ローカルの変更を残す。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from 'react-resizable-panels'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { foldGutter, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  theme,
  setEditorTheme,
  setOptionsTheme,
} from '@/features/source-editor/extensions/theme'
import {
  language,
  type Metadata,
} from '@/features/source-editor/extensions/language'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import { useActiveEditorTheme } from '@/shared/hooks/use-active-editor-theme'
import { HorizontalResizeHandle } from '@/features/ide-react/components/resize/horizontal-resize-handle'
import { getJSON, putJSON } from '@/infrastructure/fetch-json'
import { collectTexDocs } from './tex-docs'

type Session = { id: string; view: EditorView; version: number; saved: string }
const errorMessage = (error: unknown) =>
  (error as { data?: { detail?: string }; message?: string })?.data?.detail ||
  (error as Error)?.message ||
  '処理に失敗しました。'

export default function BilingualEditorPanel({ order }: { order?: number }) {
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { currentDocumentId } = useEditorOpenDocContext()
  const permissions = usePermissionsContext()
  const { userSettings } = useUserSettingsContext()
  const overallTheme = useActiveOverallTheme()
  const editorTheme = useActiveEditorTheme()
  const [open, setOpen] = useState(false)
  const [docId, setDocId] = useState('')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const session = useRef<Session | null>(null)
  const savingRef = useRef(false)
  const saveRef = useRef<() => void>(() => {})
  const editable = useRef(new Compartment())
  const options = useMemo(() => collectTexDocs(fileTreeData), [fileTreeData])
  const selected = options.find(doc => doc.id === docId)
  const canEdit = Boolean(
    permissions.write && selected && currentDocumentId !== docId
  )
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const apiPath = `/project/${projectId}/local-llm/doc-content`
  const themeOptions = {
    fontSize: userSettings.fontSize,
    fontFamily: userSettings.fontFamily,
    lineHeight: userSettings.lineHeight,
    activeOverallTheme: overallTheme,
  }
  const initial = useRef({ themeOptions, editorTheme, fileTreeData })
  initial.current = { themeOptions, editorTheme, fileTreeData }

  useEffect(() => {
    const onOpen = () => {
      setOpen(true)
      setDocId(previous => {
        if (previous) return previous
        const current = options.find(doc => doc.id === currentDocumentId)
        const companion = current?.path.toLowerCase().endsWith('.en.tex')
          ? current.path.slice(0, -7) + '.tex'
          : current?.path.replace(/\.tex$/i, '.en.tex')
        return (
          options.find(doc => doc.path === companion)?.id ||
          options.find(doc => doc.id !== currentDocumentId)?.id ||
          currentDocumentId ||
          ''
        )
      })
    }
    window.addEventListener('overleaf:open-bilingual-editor', onOpen)
    return () =>
      window.removeEventListener('overleaf:open-bilingual-editor', onOpen)
  }, [currentDocumentId, options])

  // 誤って画面を離れても、未保存のスナップショットを無言で捨てない。
  useEffect(() => {
    if (!dirty && !saving) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty, saving])

  useEffect(() => {
    if (!open || !docId || !host.current) return
    const controller = new AbortController()
    setLoading(true)
    setDirty(false)
    setError('')
    setNotice('')
    let view: EditorView | undefined
    getJSON<{ content: string; version: number }>(
      `${apiPath}?doc_id=${encodeURIComponent(docId)}`,
      { signal: controller.signal }
    )
      .then(async doc => {
        if (controller.signal.aborted || !host.current) return
        const data = initial.current
        const metadata: Metadata = {
          labels: new Set(),
          packageNames: new Set(),
          commands: [],
          referenceKeys: new Set(),
          searchLocalReferences: async () => ({ hits: [] }),
          fileTreeData: data.fileTreeData!,
        }
        view = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: doc.content,
            extensions: [
              theme(data.themeOptions),
              language('document.tex', metadata, { syntaxValidation: false }),
              history(),
              lineNumbers(),
              foldGutter(),
              indentOnInput(),
              closeBrackets(),
              search({ top: true }),
              EditorView.lineWrapping,
              editable.current.of([
                EditorState.readOnly.of(!canEditRef.current),
                EditorView.editable.of(canEditRef.current),
              ]),
              keymap.of([
                {
                  key: 'Mod-s',
                  preventDefault: true,
                  run: () => {
                    saveRef.current()
                    return true
                  },
                },
                ...defaultKeymap,
                ...historyKeymap,
                ...searchKeymap,
                ...closeBracketsKeymap,
                indentWithTab,
              ]),
              EditorView.contentAttributes.of({
                'aria-label': '横並びエディター',
              }),
              EditorView.updateListener.of(update => {
                if (update.docChanged && session.current?.view === update.view)
                  setDirty(
                    update.state.doc.toString() !== session.current.saved
                  )
              }),
            ],
          }),
        })
        session.current = {
          id: docId,
          view,
          version: doc.version,
          saved: doc.content,
        }
        const spec = await setEditorTheme(data.editorTheme)
        if (!controller.signal.aborted) view.dispatch(spec)
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      if (session.current?.view === view) session.current = null
      view?.destroy()
    }
  }, [apiPath, docId, open, reload])

  // メイン側で同じ文書を開いた場合や権限変更を、既存のビューにも直ちに反映する。
  useEffect(() => {
    session.current?.view.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(!canEdit),
        EditorView.editable.of(canEdit),
      ]),
    })
  }, [canEdit])
  useEffect(() => {
    session.current?.view.dispatch(setOptionsTheme(themeOptions))
  }, [
    userSettings.fontSize,
    userSettings.fontFamily,
    userSettings.lineHeight,
    overallTheme,
  ])
  useEffect(() => {
    let stale = false
    const current = session.current
    if (current)
      void setEditorTheme(editorTheme).then(spec => {
        if (!stale && session.current === current) current.view.dispatch(spec)
      })
    return () => {
      stale = true
    }
  }, [editorTheme])

  const save = useCallback(async () => {
    const current = session.current
    if (!current || !canEditRef.current || savingRef.current) return
    const content = current.view.state.doc.toString()
    savingRef.current = true
    setSaving(true)
    setError('')
    setNotice('')
    try {
      // 版は本文と同じ応答から採り、保存成功時だけ更新する。
      const result = await putJSON<{ version: number }>(apiPath, {
        body: { doc_id: current.id, content, version: current.version },
      })
      if (session.current === current) {
        current.version = result.version
        current.saved = content
        setDirty(current.view.state.doc.toString() !== content)
        setNotice('保存しました。')
      }
    } catch (failure) {
      if (session.current === current) setError(errorMessage(failure))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [apiPath])
  saveRef.current = save
  const allowDiscard = () =>
    !saving &&
    (!dirty ||
      window.confirm(
        '横並び側の未保存の変更を破棄しますか？必要な内容は先にコピーしてください。'
      ))

  if (!open) return null
  return (
    <>
      <HorizontalResizeHandle id="bilingual-editor-handle" />
      <Panel
        id="bilingual-editor-panel"
        order={order ?? 3}
        defaultSize={35}
        minSize={15}
        tagName="section"
        aria-label="日英の横並び編集"
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            color: 'var(--content-primary)',
            background: 'var(--bg-primary)',
          }}
        >
          <header
            style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            <label style={{ flex: 1 }}>
              横並びで開く .tex
              <select
                aria-label="横並びで開く .tex"
                className="form-select"
                value={docId}
                disabled={saving || loading}
                onChange={event => {
                  if (allowDiscard()) setDocId(event.target.value)
                }}
              >
                <option value="" disabled>
                  ファイルを選択
                </option>
                {options.map(doc => (
                  <option key={doc.id} value={doc.id}>
                    {doc.path}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                if (allowDiscard()) {
                  // 破棄の確認後は、閉じたパネルの離脱警告も解除する。
                  setDirty(false)
                  setOpen(false)
                }
              }}
            >
              横並びを閉じる
            </button>
          </header>
          <div
            style={{
              padding: '0 12px 12px',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canEdit || !dirty || saving || loading}
              onClick={save}
            >
              {saving ? '保存中…' : '横並びの変更を保存'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving || loading}
              onClick={() => {
                if (allowDiscard()) setReload(value => value + 1)
              }}
            >
              再読込
            </button>
            <span role="status">
              {loading
                ? '読み込み中…'
                : dirty
                  ? '未保存の変更があります。'
                  : notice}
            </span>
          </div>
          {currentDocumentId === docId && (
            <p style={{ padding: '0 12px' }}>
              同じ文書をメインで開いているため、横並び側は読み取り専用です。
            </p>
          )}
          {!permissions.write && (
            <p style={{ padding: '0 12px' }}>閲覧専用です。</p>
          )}
          {error && (
            <div role="alert" className="alert alert-danger">
              {error}
            </div>
          )}
          <div ref={host} style={{ flex: 1, minHeight: 0, overflow: 'auto' }} />
        </div>
      </Panel>
    </>
  )
}
