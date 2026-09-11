import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { openSelectedWordCount } from '../../selected-word-count-events'

export default function useSelectedWordCountAction() {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()

  const handleClick = useCallback(() => {
    const { doc, selection } = view.state
    const { from, to } = selection.main

    if (from === to) {
      return
    }

    openSelectedWordCount({ doc, from, to })
  }, [view])

  return {
    isSelectionEmpty: view.state.selection.main.empty,
    handleClick,
    label: t('word_count'),
  }
}
