import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AdminSettings from '../frontend/js/components/llm-admin-settings-page'
import UserSettings from '../frontend/js/components/llm-settings-section'

const api = vi.hoisted(() => ({ getJSON: vi.fn(), postJSON: vi.fn() }))
vi.mock('@/infrastructure/fetch-json', () => api)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}))
vi.mock('@/shared/components/material-icon', () => ({ default: () => null }))
vi.mock('@/utils/meta', () => ({
  default: (key: string) =>
    ({
      'ol-ExposedSettings': { llmEnabled: true, llmAllowUserSettings: false },
      'ol-hasLlmApiKey': 'true',
      'ol-llmApiUrl': 'https://llm.example/v1',
      'ol-llmApiType': 'openai',
      'ol-allowedModels': 'model-a',
    })[key],
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.getJSON.mockImplementation(async (path: string) =>
    path.includes('feature-models')
      ? {
          ok: true,
          models: {},
          chatContextMode: 'off',
          chatContextBudget: 3000,
        }
      : { ok: false }
  )
  api.postJSON.mockResolvedValue({ success: true })
})

it('keeps a stored admin key out of the page and saves an empty key to retain it', async () => {
  render(<AdminSettings />)
  const key = screen.getByLabelText('API Key') as HTMLInputElement
  expect(key.value).toBe('')
  expect(key.type).toBe('password')
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
  await waitFor(() => expect(api.postJSON).toHaveBeenCalled())
  expect(api.postJSON.mock.calls[0][0]).toBe('/admin/llm/settings')
  expect(api.postJSON.mock.calls[0][1].body.llmApiKey).toBe('')
})
it('allows context settings without enabling personal provider registration', async () => {
  render(<UserSettings />)
  await screen.findByText('チャットのモデル・参照設定')
  expect(screen.queryByRole('button', { name: 'Add provider' })).toBeNull()
  expect(
    api.getJSON.mock.calls.some(([path]) => path === '/user/llm-providers')
  ).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'チャット設定を保存' }))
  await waitFor(() => expect(api.postJSON).toHaveBeenCalled())
  expect(api.postJSON.mock.calls[0][1].body.chatContextMode).toBe('off')
  expect(api.postJSON.mock.calls[0][1].body.chatContextBudget).toBe(3000)
})
