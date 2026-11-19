import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLLMModelSelection } from '../frontend/js/hooks/use-llm-model-selection'
const api = vi.hoisted(() => ({ getJSON: vi.fn(), postJSON: vi.fn() }))
vi.mock('@/utils/meta', () => ({ default: () => 'project' }))
vi.mock('@/infrastructure/fetch-json', () => api)
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.getJSON.mockImplementation(async (path: string) =>
    path.endsWith('/models')
      ? { models: [{ id: 'model-a', name: 'A' }] }
      : { selected: '' }
  )
})
afterEach(cleanup)
it('keeps the previous choice visible and reports a failed profile save', async () => {
  api.postJSON.mockRejectedValue(new Error('offline'))
  const { result } = renderHook(useLLMModelSelection)
  await waitFor(() => expect(result.current.loaded).toBe(true))
  await act(() => result.current.apply('model-a'))
  expect(result.current.selected).toBe('')
  expect(result.current.saveError).toContain('保存できません')
})
it('notifies other surfaces only after the server accepts the model', async () => {
  let accept!: () => void
  api.postJSON.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        accept = resolve
      })
  )
  const { result } = renderHook(useLLMModelSelection)
  await waitFor(() => expect(result.current.loaded).toBe(true))
  let saving!: Promise<void>
  act(() => {
    saving = result.current.apply('model-a')
  })
  expect(result.current.saving).toBe(true)
  expect(result.current.selected).toBe('')
  await act(async () => {
    accept()
    await saving
  })
  expect(result.current.selected).toBe('model-a')
  expect(result.current.saveError).toBe('')
})
