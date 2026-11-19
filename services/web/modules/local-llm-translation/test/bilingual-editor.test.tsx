import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import SplitLauncherPanel from '../frontend/js/rail/SplitLauncherPanel'
import BilingualEditorPanel from '../frontend/js/split/BilingualEditorPanel'
import { collectTexDocs } from '../frontend/js/split/tex-docs'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  main: 'jp',
  write: true,
}))
const tree = {
  _id: 'root',
  name: '',
  docs: [
    { _id: 'jp', name: 'main.tex' },
    { _id: 'en', name: 'main.en.tex' },
  ],
  folders: [
    {
      _id: 'nested',
      name: 'chapters',
      docs: [
        { _id: 'chapter', name: 'INTRO.TEX' },
        { _id: 'bib', name: 'ref.bib' },
      ],
      folders: [],
      fileRefs: [],
    },
  ],
  fileRefs: [],
}
vi.mock('@/shared/context/project-context', () => ({
  useProjectContext: () => ({ projectId: 'project' }),
}))
vi.mock('@/shared/context/file-tree-data-context', () => ({
  useFileTreeData: () => ({ fileTreeData: tree }),
}))
vi.mock('@/features/ide-react/context/editor-open-doc-context', () => ({
  useEditorOpenDocContext: () => ({ currentDocumentId: mocks.main }),
}))
vi.mock('@/features/ide-react/context/permissions-context', () => ({
  usePermissionsContext: () => ({ write: mocks.write }),
}))
vi.mock('@/shared/context/user-settings-context', () => ({
  useUserSettingsContext: () => ({
    userSettings: { fontSize: 12, fontFamily: 'monaco', lineHeight: 'normal' },
  }),
}))
vi.mock('@/shared/hooks/use-active-overall-theme', () => ({
  useActiveOverallTheme: () => 'light',
}))
vi.mock('@/shared/hooks/use-active-editor-theme', () => ({
  useActiveEditorTheme: () => 'textmate',
}))
vi.mock('@/features/source-editor/extensions/theme', () => ({
  theme: () => [],
  setEditorTheme: async () => ({}),
  setOptionsTheme: () => ({}),
}))
vi.mock('@/features/source-editor/extensions/language', () => ({
  language: () => [],
}))
vi.mock(
  '@/features/ide-react/components/resize/horizontal-resize-handle',
  () => ({ HorizontalResizeHandle: () => null })
)
vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))
vi.mock('@/infrastructure/fetch-json', () => ({
  getJSON: mocks.get,
  putJSON: mocks.put,
}))

beforeEach(() => {
  localStorage.clear()
  mocks.main = 'jp'
  mocks.write = true
  mocks.get.mockResolvedValue({ content: 'English before', version: 5 })
  mocks.put.mockResolvedValue({ version: 6 })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  // jsdom には描画レイアウトがないが、実際の CM の変更処理・undo はそのまま使う。
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.useRealTimers()
})
function open() {
  const result = render(<BilingualEditorPanel />)
  act(() => {
    window.dispatchEvent(new Event('overleaf:open-bilingual-editor'))
  })
  return result
}
async function editor() {
  return EditorView.findFromDOM(
    await screen.findByRole('textbox', { name: '横並びエディター' })
  )!
}
function replace(view: EditorView, text: string) {
  act(() =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    })
  )
}
const saveButton = () =>
  screen.getByRole('button', {
    name: '横並びの変更を保存',
  }) as HTMLButtonElement

it('lists nested .tex documents using the official Folder shape', () => {
  expect(collectTexDocs({ ...tree, name: 'rootFolder' })).toEqual([
    { id: 'jp', name: 'main.tex', path: 'main.tex' },
    { id: 'en', name: 'main.en.tex', path: 'main.en.tex' },
    { id: 'chapter', name: 'INTRO.TEX', path: 'chapters/INTRO.TEX' },
  ])
})
it('chooses the English companion and saves against the version from the read', async () => {
  open()
  const view = await editor()
  replace(view, 'English edited')
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('en')
  fireEvent.click(saveButton())
  await waitFor(() =>
    expect(mocks.put).toHaveBeenCalledWith(
      '/project/project/local-llm/doc-content',
      { body: { doc_id: 'en', content: 'English edited', version: 5 } }
    )
  )
  await screen.findByText('保存しました。')
  expect(saveButton().disabled).toBe(true)
})
it('keeps local edits and the previous version when MCP or another editor wins', async () => {
  mocks.put.mockRejectedValue({
    data: { detail: '別の場所で更新されています。' },
  })
  open()
  const view = await editor()
  replace(view, 'Local draft')
  fireEvent.click(saveButton())
  await screen.findByRole('alert')
  expect(view.state.doc.toString()).toBe('Local draft')
  expect(saveButton().disabled).toBe(false)
  vi.mocked(window.confirm).mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: '再読込' }))
  expect(view.state.doc.toString()).toBe('Local draft')
  expect(mocks.get).toHaveBeenCalledTimes(1)
})
it('retains edits made during a save and uses the returned version next time', async () => {
  let resolve!: (value: { version: number }) => void
  mocks.put.mockReturnValueOnce(
    new Promise(yes => {
      resolve = yes
    })
  )
  open()
  const view = await editor()
  replace(view, 'first edit')
  fireEvent.click(saveButton())
  replace(view, 'second edit')
  await act(async () => {
    resolve({ version: 6 })
  })
  expect(saveButton().disabled).toBe(false)
  fireEvent.click(saveButton())
  await waitFor(() =>
    expect(mocks.put).toHaveBeenLastCalledWith(
      '/project/project/local-llm/doc-content',
      { body: { doc_id: 'en', content: 'second edit', version: 6 } }
    )
  )
})
it('makes the side view read-only when main opens it or write permission is lost', async () => {
  const result = open()
  const view = await editor()
  replace(view, 'Local draft')
  mocks.main = 'en'
  result.rerender(<BilingualEditorPanel />)
  expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
  expect(saveButton().disabled).toBe(true)
  mocks.main = 'jp'
  mocks.write = false
  result.rerender(<BilingualEditorPanel />)
  expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
  expect(saveButton().disabled).toBe(true)
})
it('discards a late read after closing and reopening the panel', async () => {
  let resolve!: (value: { content: string; version: number }) => void
  mocks.get.mockReturnValueOnce(
    new Promise(yes => {
      resolve = yes
    })
  )
  open()
  fireEvent.click(screen.getByRole('button', { name: '横並びを閉じる' }))
  act(() => {
    window.dispatchEvent(new Event('overleaf:open-bilingual-editor'))
  })
  const view = await editor()
  await act(async () => {
    resolve({ content: 'Stale read', version: 1 })
  })
  expect(view.state.doc.toString()).toBe('English before')
  expect(mocks.get.mock.calls[0][1].signal.aborted).toBe(true)
})

it('clears the navigation warning after explicitly discarding a closed panel', async () => {
  open()
  const view = await editor()
  replace(view, 'Discarded draft')
  const before = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '横並びを閉じる' }))
  const after = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(after)
  expect(after.defaultPrevented).toBe(false)
  expect(screen.queryByRole('textbox', { name: '横並びエディター' })).toBeNull()
})

it('keeps separate document content and undo history while switching tabs', async () => {
  open()
  const english = await editor()
  replace(english, 'English draft')
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'chapter' },
  })
  const chapter = await editor()
  replace(chapter, 'Chapter draft')
  fireEvent.click(screen.getByRole('tab', { name: 'main.en.tex' }))
  expect(await editor()).toBe(english)
  expect(english.state.doc.toString()).toBe('English draft')
  act(() => {
    undo(english)
  })
  expect(english.state.doc.toString()).toBe('English before')
  fireEvent.click(screen.getByRole('tab', { name: 'chapters/INTRO.TEX' }))
  expect(await editor()).toBe(chapter)
  expect(chapter.state.doc.toString()).toBe('Chapter draft')
  expect(mocks.get).toHaveBeenCalledTimes(2)
})
it('confirms discarding a tab but allows switching without discarding', async () => {
  open()
  const english = await editor()
  replace(english, 'Unsaved English')
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'chapter' },
  })
  await editor()
  expect(window.confirm).not.toHaveBeenCalled()
  vi.mocked(window.confirm).mockReturnValue(false)
  fireEvent.click(
    screen.getByRole('button', { name: 'main.en.tex のタブを閉じる' })
  )
  expect(screen.getByRole('tab', { name: 'main.en.tex' })).toBeTruthy()
  vi.mocked(window.confirm).mockReturnValue(true)
  fireEvent.click(
    screen.getByRole('button', { name: 'main.en.tex のタブを閉じる' })
  )
  expect(screen.queryByRole('tab', { name: 'main.en.tex' })).toBeNull()
  expect(screen.getByRole('tab', { name: 'chapters/INTRO.TEX' })).toBeTruthy()
})
it('restores tab IDs and active tab without storing unsaved document text', async () => {
  const result = open()
  replace(await editor(), 'Private unsaved text')
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'chapter' },
  })
  await editor()
  const stored = localStorage.getItem('bilingual-editor-tabs:project')!
  expect(stored).not.toContain('Private unsaved text')
  result.unmount()
  render(<BilingualEditorPanel />)
  expect(
    screen
      .getByRole('tab', { name: 'chapters/INTRO.TEX' })
      .getAttribute('aria-selected')
  ).toBe('true')
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect((await editor()).state.doc.toString()).toBe('English before')
})
it('preserves a dirty tab when translation opens the saved English document', async () => {
  open()
  const english = await editor()
  replace(english, 'Unsaved side draft')
  act(() => {
    window.dispatchEvent(
      new CustomEvent('overleaf:open-bilingual-editor', {
        detail: { docId: 'en', refresh: true },
      })
    )
  })
  expect(await editor()).toBe(english)
  expect(english.state.doc.toString()).toBe('Unsaved side draft')
  expect(mocks.get).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/編集中の内容は保持/)).toBeTruthy()
})
it('reloads a clean existing tab when a new translation is saved', async () => {
  open()
  const first = await editor()
  mocks.get.mockResolvedValueOnce({ content: 'New translation', version: 8 })
  act(() => {
    window.dispatchEvent(
      new CustomEvent('overleaf:open-bilingual-editor', {
        detail: { docId: 'en', refresh: true },
      })
    )
  })
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: '横並びエディター' }).textContent
    ).toBe('New translation')
  )
  expect(await editor()).not.toBe(first)
  expect(mocks.get).toHaveBeenCalledTimes(2)
})

it('autosaves after typing and stops automatic retries after a conflict', async () => {
  open()
  const view = await editor()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  mocks.put.mockRejectedValueOnce({ data: { detail: 'Conflict' } })
  replace(view, 'Autosaved draft')
  await act(async () => {
    vi.advanceTimersByTime(1500)
  })
  expect(mocks.put).toHaveBeenCalledTimes(1)
  expect(view.state.doc.toString()).toBe('Autosaved draft')
  await act(async () => {
    vi.advanceTimersByTime(30000)
  })
  replace(view, 'Keep local edits')
  await act(async () => {
    vi.advanceTimersByTime(30000)
  })
  expect(mocks.put).toHaveBeenCalledTimes(1)
})
it('keeps autosave versions separate for each tab', async () => {
  open()
  const english = await editor()
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'chapter' },
  })
  const chapter = await editor()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  replace(english, 'English autosave')
  replace(chapter, 'Chapter autosave')
  await act(async () => {
    vi.advanceTimersByTime(1500)
  })
  expect(mocks.put).toHaveBeenCalledWith(
    '/project/project/local-llm/doc-content',
    { body: { doc_id: 'en', content: 'English autosave', version: 5 } }
  )
  expect(mocks.put).toHaveBeenCalledWith(
    '/project/project/local-llm/doc-content',
    { body: { doc_id: 'chapter', content: 'Chapter autosave', version: 5 } }
  )
})
it('opens a selected document from the rail launcher', () => {
  const listener = vi.fn()
  window.addEventListener('overleaf:open-bilingual-editor', listener)
  try {
    render(<SplitLauncherPanel />)
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'chapter' },
    })
    fireEvent.click(screen.getByRole('button', { name: '横並びで開く' }))
    expect(listener.mock.calls[0][0].detail).toEqual({ docId: 'chapter' })
  } finally {
    window.removeEventListener('overleaf:open-bilingual-editor', listener)
  }
})
