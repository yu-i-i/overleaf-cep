import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProjectSettingsContext } from '@/features/editor-left-menu/context/project-settings-context'
import { createSegmenters } from '@/features/word-count-modal/utils/segmenters'
import { debugConsole } from '@/utils/debugging'
import {
  SELECTED_WORD_COUNT_OPEN_EVENT,
  type SelectedWordCountRequest,
} from '../selected-word-count-events'
import { countWordsInSelection } from '../utils/count-words-in-selection'
import SelectedWordCountModal from './selected-word-count-modal'

export default function SelectedWordCountController() {
  const { spellCheckLanguage } = useProjectSettingsContext()
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<SelectedWordCountRequest | null>(null)
  const [wordCount, setWordCount] = useState<number | null>(null)
  const [error, setError] = useState(false)

  const segmenters = useMemo(() => {
    return createSegmenters(spellCheckLanguage?.replace(/_/, '-'))
  }, [spellCheckLanguage])

  const onClose = useCallback(() => {
    setOpen(false)
    setRequest(null)
  }, [])

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const { detail } = event as CustomEvent<SelectedWordCountRequest>

      if (!detail || detail.from >= detail.to) {
        return
      }

      setRequest(detail)
      setWordCount(null)
      setError(false)
      setOpen(true)
    }

    window.addEventListener(SELECTED_WORD_COUNT_OPEN_EVENT, handleOpen)
    return () => {
      window.removeEventListener(SELECTED_WORD_COUNT_OPEN_EVENT, handleOpen)
    }
  }, [])

  useEffect(() => {
    if (!open || !request) {
      return
    }

    try {
      const nextWordCount = countWordsInSelection(
        request.doc.toString(),
        { from: request.from, to: request.to },
        segmenters
      )
      setWordCount(nextWordCount)
    } catch (error) {
      debugConsole.error(error)
      setError(true)
    }
  }, [open, request, segmenters])

  return (
    <SelectedWordCountModal
      show={open}
      onClose={onClose}
      wordCount={wordCount}
      error={error}
    />
  )
}
