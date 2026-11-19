import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  CodeMirrorStateContext,
  CodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import TranslationPanel from '../frontend/js/rail/TranslationPanel'
import CodeMirrorBridge from '../frontend/js/rail/CodeMirrorBridge'
import {
  getBridgedEditor,
  publishEditor,
  clearEditor,
  subscribeBridgedEditor,
} from '../frontend/js/rail/editor-bridge'

const mock = vi.hoisted(() => ({
  docId: 'main',
  loading: false,
  write: true,
  projectId: 'project',
  view: null as unknown,
}))
vi.mock('@codemirror/language', () => ({ language: {} }))
vi.mock('@/features/ide-react/context/editor-open-doc-context', () => ({
  useEditorOpenDocContext: () => ({
    currentDocumentId: mock.docId,
    currentDocument: { doc_id: mock.docId, cm6: { view: mock.view } },
  }),
}))
vi.mock('@/features/ide-react/context/editor-manager-context', () => ({
  useEditorManagerContext: () => ({ isLoading: mock.loading }),
}))
vi.mock('@/features/ide-react/context/permissions-context', () => ({
  usePermissionsContext: () => ({ write: mock.write }),
}))
vi.mock('@/shared/context/project-context', () => ({
  useProjectContext: () => ({ projectId: mock.projectId }),
}))
vi.mock('../frontend/js/TranslationToolbar', () => ({
  default: function Toolbar({
    embedded,
    editorAvailable,
  }: {
    embedded: boolean
    editorAvailable: boolean
  }) {
    // 本体が作り直されていないことを、翻訳状態に相当するローカル状態で確認する。
    const [count, setCount] = useState(0)
    return (
      <button
        onClick={() => setCount(count + 1)}
        data-embedded={String(embedded)}
        data-available={String(editorAvailable)}
      >
        preview:{count}
      </button>
    )
  },
}))
function editor(name = 'latex') {
  return {
    state: { facet: () => ({ name }) } as unknown as EditorState,
    view: {} as EditorView,
    docId: mock.docId,
  }
}
beforeEach(() => {
  mock.docId = 'main'
  mock.loading = false
  mock.write = true
  mock.projectId = 'project'
})
afterEach(() => {
  cleanup()
  const current = getBridgedEditor()
  if (current) clearEditor(current.view)
  vi.restoreAllMocks()
})

it('guides the user when no editor exists or the project is read-only', () => {
  const result = render(<TranslationPanel />)
  expect(screen.getByText(/\.tex ファイルをエディターで開いて/)).toBeTruthy()
  mock.write = false
  result.rerender(<TranslationPanel />)
  expect(screen.getByText(/編集権限が必要/)).toBeTruthy()
})
it('retains preview state while loading, switching documents and closing the editor', () => {
  const first = editor()
  publishEditor(first)
  const result = render(<TranslationPanel />)
  const button = screen.getByRole('button', { name: 'preview:0' })
  expect(button.getAttribute('data-embedded')).toBe('true')
  expect(button.getAttribute('data-available')).toBe('true')
  fireEvent.click(button)
  mock.loading = true
  result.rerender(<TranslationPanel />)
  expect(
    screen
      .getByRole('button', { name: 'preview:1' })
      .getAttribute('data-available')
  ).toBe('false')
  mock.docId = 'other'
  mock.loading = false
  act(() => publishEditor(editor()))
  result.rerender(<TranslationPanel />)
  expect(
    screen
      .getByRole('button', { name: 'preview:1' })
      .getAttribute('data-available')
  ).toBe('true')
  act(() => clearEditor(getBridgedEditor()!.view))
  expect(
    screen
      .getByRole('button', { name: 'preview:1' })
      .getAttribute('data-available')
  ).toBe('false')
})
it('does not use a non-LaTeX editor and resets previews for another project', () => {
  publishEditor(editor('bibtex'))
  const result = render(<TranslationPanel />)
  expect(screen.queryByRole('button')).toBeNull()
  act(() => publishEditor(editor()))
  fireEvent.click(screen.getByRole('button'))
  mock.projectId = 'new-project'
  result.rerender(<TranslationPanel />)
  expect(screen.getByRole('button', { name: 'preview:0' })).toBeTruthy()
})
it('publishes edits without clearing the bridge between keystrokes', () => {
  const first = editor()
  mock.view = first.view
  const snapshots: unknown[] = []
  const unsubscribe = subscribeBridgedEditor(() =>
    snapshots.push(getBridgedEditor())
  )
  const wrap = (state: EditorState) => (
    <CodeMirrorViewContext.Provider value={first.view}>
      <CodeMirrorStateContext.Provider value={state}>
        <CodeMirrorBridge />
      </CodeMirrorStateContext.Provider>
    </CodeMirrorViewContext.Provider>
  )
  const result = render(wrap(first.state))
  const secondState = editor().state
  result.rerender(wrap(secondState))
  expect(getBridgedEditor()?.state).toBe(secondState)
  expect(snapshots).toHaveLength(2)
  expect(snapshots.every(Boolean)).toBe(true)
  result.unmount()
  expect(getBridgedEditor()).toBeNull()
  unsubscribe()
})
it('ignores cleanup from an old view and does not republish identical state', () => {
  const first = editor(),
    second = editor()
  const listener = vi.fn()
  const unsubscribe = subscribeBridgedEditor(listener)
  publishEditor(first)
  publishEditor(second)
  publishEditor(second)
  clearEditor(first.view)
  expect(getBridgedEditor()).toBe(second)
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
  clearEditor(second.view)
  expect(listener).toHaveBeenCalledTimes(2)
})

it('does not replace the main editor with a view from another panel', () => {
  const main = editor()
  const side = editor()
  mock.view = main.view
  publishEditor(main)
  const result = render(
    <CodeMirrorViewContext.Provider value={side.view}>
      <CodeMirrorStateContext.Provider value={side.state}>
        <CodeMirrorBridge />
      </CodeMirrorStateContext.Provider>
    </CodeMirrorViewContext.Provider>
  )
  expect(getBridgedEditor()).toBe(main)
  result.unmount()
  expect(getBridgedEditor()).toBe(main)
})
