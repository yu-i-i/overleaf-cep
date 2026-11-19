export interface EditorSnapshot {
  file: string
  text: string
  from: number
  selection: string
  truncated: boolean
}

// レールとエディターは異なるReactコンテキストにあるため同期イベントで問い合わせます。
// ハンドラーがない場合は undefined を返し、本文を添えずにチャットを送信できます。
export function requestEditorSnapshot(): EditorSnapshot | undefined {
  const detail: { snapshot?: EditorSnapshot } = {}
  window.dispatchEvent(new CustomEvent('llm-chat-snapshot', { detail }))
  return detail.snapshot
}
