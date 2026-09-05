import type { Text } from '@codemirror/state'

export const SELECTED_WORD_COUNT_OPEN_EVENT = 'selected-word-count:open'

export type SelectedWordCountRequest = {
  doc: Text
  from: number
  to: number
}

export const openSelectedWordCount = (request: SelectedWordCountRequest) => {
  window.dispatchEvent(
    new CustomEvent<SelectedWordCountRequest>(SELECTED_WORD_COUNT_OPEN_EVENT, {
      detail: request,
    })
  )
}
