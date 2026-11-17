import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { getJSON, postJSON } from '../../frontend/js/infrastructure/fetch-json'
import { useProjectEntities } from '../../frontend/js/features/file-tree/hooks/use-project-entities'
import { useProjectOutputFiles } from '../../frontend/js/features/file-tree/hooks/use-project-output-files'

vi.mock('../../frontend/js/infrastructure/fetch-json', () => ({
  getJSON: vi.fn(),
  postJSON: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function deferred() {
  let resolve!: (value: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise<any>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// AbortSignal を無視して遅れて応答する通信も再現し、状態の上書きを防ぐ。
for (const [name, hook, request, response] of [
  [
    'sources',
    useProjectEntities,
    getJSON,
    (path: string) => ({ entities: [{ path }] }),
  ],
  [
    'outputs',
    useProjectOutputFiles,
    postJSON,
    (path: string) => ({
      status: 'success',
      outputFiles: [{ path, build: 'build' }],
      clsiServerId: 'server',
      compileGroup: 'group',
    }),
  ],
] as const) {
  describe(name, () => {
    it('ignores an old response after selecting another project', async () => {
      const old = deferred(),
        current = deferred()
      vi.mocked(request)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise)
      const { result, rerender } = renderHook(({ id }) => hook(id), {
        initialProps: { id: 'old' },
      })
      const oldSignal = vi.mocked(request).mock.calls[0][1]!.signal!
      rerender({ id: 'current' })
      expect(oldSignal.aborted).toBe(true)
      expect(result.current.data).toBeNull()
      await act(async () => {
        current.resolve(response('current.pdf'))
        await current.promise
      })
      await act(async () => {
        old.resolve(response('old.pdf'))
        await old.promise
      })
      expect(result.current.data?.map(file => file.path)).toEqual([
        'current.pdf',
      ])
      expect(result.current.loading).toBe(false)
    })
    it('ignores old failures and clears state when selection is removed', async () => {
      const old = deferred(),
        current = deferred()
      vi.mocked(request)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise)
      const { result, rerender, unmount } = renderHook(
        ({ id }: { id?: string }) => hook(id),
        { initialProps: { id: 'old' } }
      )
      rerender({ id: 'current' })
      await act(async () => {
        old.reject(new Error('old failure'))
        await old.promise.catch(() => {})
      })
      expect(result.current.error).toBe(false)
      expect(result.current.loading).toBe(true)
      await act(async () => {
        current.resolve(response('current.pdf'))
        await current.promise
      })
      rerender({ id: undefined })
      expect(result.current).toEqual({
        data: null,
        error: false,
        loading: false,
      })
      unmount()
      expect(vi.mocked(request).mock.calls[1][1]!.signal!.aborted).toBe(true)
    })
  })
}

it('filters complete image extensions and attaches the matching build server without mutating the response', async () => {
  const files = [
    { path: 'z.PDF', build: 'b' },
    { path: 'a.jpeg', build: 'b' },
    { path: 'bad.pdf.log', build: 'b' },
    { path: 'output.log', build: 'b' },
  ]
  vi.mocked(postJSON).mockResolvedValue({
    status: 'success',
    outputFiles: files,
    clsiServerId: 'new-server',
    compileGroup: 'group',
  })
  const { result } = renderHook(() => useProjectOutputFiles('source'))
  await act(async () => {})
  expect(result.current.data).toEqual([
    {
      path: 'a.jpeg',
      build: 'b',
      clsiServerId: 'new-server',
      compileGroup: 'group',
    },
    {
      path: 'z.PDF',
      build: 'b',
      clsiServerId: 'new-server',
      compileGroup: 'group',
    },
  ])
  expect(files[0]).toEqual({ path: 'z.PDF', build: 'b' })
})
