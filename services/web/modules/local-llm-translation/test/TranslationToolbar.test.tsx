import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import TranslationToolbar from '../frontend/js/TranslationToolbar'

const mock = vi.hoisted(() => ({
  text: '日本語の原文',
  docId: 'source',
  selection: { empty: true, from: 0, to: 4 },
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  copy: vi.fn(),
  dispatch: vi.fn(),
}))
vi.mock('@codemirror/language', () => ({ language: {} }))
function state() {
  return {
    facet: () => ({ name: 'latex' }),
    selection: { main: mock.selection },
    doc: {
      toString: () => mock.text,
      length: mock.text.length,
      sliceString: (from: number, to: number) => mock.text.slice(from, to),
    },
  }
}
vi.mock('@/features/source-editor/components/codemirror-context', () => ({
  useCodeMirrorStateContext: () => state(),
  useCodeMirrorViewContext: () => ({ state: state(), dispatch: mock.dispatch }),
}))
vi.mock('@/features/ide-react/context/permissions-context', () => ({
  usePermissionsContext: () => ({ write: true }),
}))
vi.mock('@/features/ide-react/context/editor-manager-context', () => ({
  useEditorManagerContext: () => ({
    getCurrentDocumentId: () => mock.docId,
    openDoc: vi.fn(),
  }),
}))
vi.mock('@/features/file-tree/contexts/file-tree-path', () => ({
  useFileTreePathContext: () => ({
    pathInFolder: () => 'main.tex',
    dirname: () => '',
    findEntityByPath: (path: string) =>
      path === '' ? { type: 'folder', entity: { _id: 'root' } } : undefined,
  }),
}))
vi.mock('@/shared/context/project-context', () => ({
  useProjectContext: () => ({
    projectId: 'project',
    project: {},
    updateProject: vi.fn(),
  }),
}))
vi.mock('@/infrastructure/fetch-json', () => ({
  getJSON: mock.get,
  putJSON: mock.put,
  postJSON: mock.post,
}))
vi.mock('@/utils/meta', () => ({ default: () => 'csrf' }))
vi.mock('../frontend/js/ConnectionSettings', () => ({ default: () => null }))

const confirmed = '\\begin{document}\nConfirmed English\n'
const draftName = '訳済み部分だけ英語版 .tex に保存（草稿）'
let stream: ReadableStreamDefaultController<Uint8Array>
function event(value: unknown) {
  stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
}

beforeEach(() => {
  mock.text = '日本語の原文'
  mock.docId = 'source'
  mock.selection = { empty: true, from: 0, to: 4 }
  mock.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/models')
        ? { data: [{ id: 'test' }] }
        : { terms: [], model: 'test', context: '' }
    )
  )
  mock.put.mockResolvedValue({
    terms: [],
    doc: { _id: 'english', name: 'main.en.tex' },
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mock.copy.mockResolvedValue(undefined) },
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, options) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller
          // HTTP の中断と同じく読み取りを失敗させ、確定済み分だけが残ることを調べる。
          options.signal.addEventListener('abort', () =>
            controller.error(new DOMException('Aborted', 'AbortError'))
          )
        },
      })
      return Promise.resolve({ ok: true, body })
    })
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function start() {
  const view = render(<TranslationToolbar />)
  fireEvent.click(screen.getByRole('button', { name: '日本語から英語へ翻訳' }))
  await screen.findByRole('option', { name: 'test' })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認して翻訳' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  return view
}
async function fail() {
  await act(async () => {
    event({ type: 'chunk_complete', chunk: 1, text: confirmed })
    event({ type: 'delta', chunk: 2, text: 'UNCONFIRMED' })
    event({ type: 'error', detail: 'validation failed' })
    stream.close()
  })
  await screen.findByRole('button', { name: '訳済み部分をコピー' })
}

describe('translation draft recovery', () => {
  it('saves only confirmed chunks after failure, without replacing the source or changing the main document', async () => {
    await start()
    await fail()
    expect(
      screen.queryByRole('button', { name: '保存して英語版をメイン文書に設定' })
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: draftName }))
    await waitFor(() =>
      expect(mock.put).toHaveBeenCalledWith(
        '/project/project/local-llm/english-document',
        {
          body: {
            source_doc_id: 'source',
            parent_folder_id: 'root',
            name: 'main.en.tex',
            content: confirmed,
            overwrite: false,
          },
        }
      )
    )
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('文書全体の LaTeX 検証')
    )
    expect(mock.post).not.toHaveBeenCalled()
    expect(mock.dispatch).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: draftName })).toBeNull()
    )
    expect(screen.queryByText('UNCONFIRMED')).toBeNull()
  })
  it('recovers confirmed chunks after stopping an in-flight translation', async () => {
    await start()
    await act(async () => {
      event({ type: 'chunk_complete', chunk: 1, text: confirmed })
      event({ type: 'delta', chunk: 2, text: 'UNCONFIRMED' })
    })
    expect(screen.queryByRole('button', { name: draftName })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '翻訳を停止' }))
    await screen.findByRole('button', { name: draftName })
    fireEvent.click(screen.getByRole('button', { name: '訳済み部分をコピー' }))
    await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(confirmed))
  })
  it('keeps the draft if confirmation is cancelled or saving fails', async () => {
    await start()
    await fail()
    mock.put.mockClear()
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: draftName }))
    expect(mock.put).not.toHaveBeenCalled()
    vi.mocked(window.confirm).mockReturnValue(true)
    mock.put.mockRejectedValueOnce(new Error('save failed'))
    fireEvent.click(screen.getByRole('button', { name: draftName }))
    await screen.findByText('save failed')
    fireEvent.click(screen.getByRole('button', { name: '訳済み部分をコピー' }))
    await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(confirmed))
  })
  for (const change of ['text', 'document']) {
    it(`disables draft saving after the source ${change} changes but still permits copying`, async () => {
      const view = await start()
      await fail()
      if (change === 'text') mock.text += ' edited'
      else mock.docId = 'other'
      view.rerender(<TranslationToolbar />)
      expect(
        (screen.getByRole('button', { name: draftName }) as HTMLButtonElement)
          .disabled
      ).toBe(true)
      fireEvent.click(
        screen.getByRole('button', { name: '訳済み部分をコピー' })
      )
      await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(confirmed))
    })
  }
  it('offers copying but no source replacement or full-file draft for a selection', async () => {
    mock.selection = { empty: false, from: 0, to: 4 }
    await start()
    await fail()
    expect(screen.queryByRole('button', { name: draftName })).toBeNull()
    expect(
      screen.queryByRole('button', { name: '選択範囲を原文に適用' })
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '訳済み部分をコピー' }))
    await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(confirmed))
  })
  it('does not offer recovery for an unconfirmed delta alone', async () => {
    await start()
    await act(async () => {
      event({ type: 'delta', chunk: 1, text: 'UNCONFIRMED' })
      stream.close()
    })
    await screen.findByText('翻訳ストリームが完了イベントを返しませんでした。')
    expect(screen.queryByRole('button', { name: draftName })).toBeNull()
    expect(
      screen.queryByRole('button', { name: '訳済み部分をコピー' })
    ).toBeNull()
  })
  it('keeps the preview when the clipboard is unavailable and clears it on reopening', async () => {
    await start()
    await fail()
    mock.copy.mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: '訳済み部分をコピー' }))
    await screen.findByText(
      'コピーに失敗しました。プレビューを選択してコピーしてください。'
    )
    expect(screen.getByRole('button', { name: draftName })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    fireEvent.click(
      screen.getByRole('button', { name: '日本語から英語へ翻訳' })
    )
    await screen.findByRole('option', { name: 'test' })
    expect(
      screen.queryByRole('button', { name: '訳済み部分をコピー' })
    ).toBeNull()
  })
  it('uses the validated final result when translation completes', async () => {
    await start()
    await act(async () => {
      event({ type: 'chunk_complete', chunk: 1, text: confirmed })
      event({
        type: 'complete',
        text: 'Validated full document',
        model: 'test',
        chunks: 1,
        protected_tokens: 0,
      })
      stream.close()
    })
    fireEvent.click(
      await screen.findByRole('button', { name: '英語版 .tex として保存' })
    )
    await waitFor(() =>
      expect(mock.put).toHaveBeenCalledWith(
        '/project/project/local-llm/english-document',
        expect.objectContaining({
          body: expect.objectContaining({ content: 'Validated full document' }),
        })
      )
    )
    expect(window.confirm).not.toHaveBeenCalled()
  })
})

it('opens the embedded panel once and keeps a stopped draft when the editor becomes unavailable', async () => {
  const view = render(<TranslationToolbar embedded />)
  await screen.findByRole('option', { name: 'test' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull()
  expect(
    screen.getByRole('region', { name: '日本語から英語へ翻訳' })
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認して翻訳' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  await fail()
  const reads = mock.get.mock.calls.length
  view.rerender(<TranslationToolbar embedded editorAvailable={false} />)
  expect(
    (screen.getByRole('button', { name: draftName }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  expect(
    (screen.getByRole('button', { name: '確認して翻訳' }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '訳済み部分をコピー' }))
  await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(confirmed))
  view.rerender(<TranslationToolbar embedded />)
  expect(mock.get.mock.calls.length).toBe(reads)
  expect(screen.getByRole('button', { name: draftName })).toBeTruthy()
})

it('opens the saved English document through the shared side-panel event', async () => {
  const events: CustomEvent[] = []
  const listener = (event: Event) => events.push(event as CustomEvent)
  window.addEventListener('overleaf:open-bilingual-editor', listener)
  try {
    await start()
    await fail()
    fireEvent.click(screen.getByRole('button', { name: draftName }))
    await waitFor(() => expect(events).toHaveLength(1))
    expect(events[0].detail).toEqual({ docId: 'english', refresh: true })
  } finally {
    window.removeEventListener('overleaf:open-bilingual-editor', listener)
  }
})
