import { createContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import LLMChatPane from '../frontend/js/components/llm-chat-pane'
import LLMChatResponse from '../frontend/js/components/llm-chat-response'

const state = vi.hoisted(() => ({
  messages: [] as Array<{ role: string; content: string }>,
  isLoading: false,
  sendMessage: vi.fn(),
  stopGeneration: vi.fn(),
  rerunLastMessage: vi.fn(),
  clearMessages: vi.fn(),
  canRerun: true,
  modelsLoaded: true,
  hasModels: true,
}))
vi.mock('../frontend/js/hooks/use-llm-chat', () => ({
  useLLMChat: () => state,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}))
vi.mock('@/shared/components/material-icon', () => ({ default: () => null }))
vi.mock('@/features/ide-react/context/editor-open-doc-context', () => ({
  EditorOpenDocContext: createContext(undefined),
}))
vi.mock('@/features/file-tree/contexts/file-tree-path', () => ({
  FileTreePathContext: createContext(undefined),
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  state.messages = []
  state.isLoading = false
})

describe('chat input', () => {
  it('waits for IME confirmation and sends on the next Enter', () => {
    render(<LLMChatPane />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '日本語で説明して' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(state.sendMessage).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(state.sendMessage).toHaveBeenCalledWith(
      '日本語で説明して',
      undefined,
      expect.objectContaining({ includeEditor: true })
    )
  })
  it('passes the editor attachment choice to the sender', () => {
    render(<LLMChatPane />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(state.sendMessage).toHaveBeenCalledWith(
      'hello',
      undefined,
      expect.objectContaining({ includeEditor: false })
    )
  })
})

it('renders Markdown while removing executable HTML from model replies', () => {
  const { container } = render(
    <LLMChatResponse
      content={
        '**LaTeX** <img src="x" onerror="alert(1)"><script>alert(1)</script>'
      }
    />
  )
  expect(container.querySelector('strong')?.textContent).toBe('LaTeX')
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('img')?.hasAttribute('onerror')).toBe(false)
})
