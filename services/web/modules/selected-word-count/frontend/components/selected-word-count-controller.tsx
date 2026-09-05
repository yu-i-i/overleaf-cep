import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Text } from '@codemirror/state'
import { useProjectSettingsContext } from '@/features/ide-settings/context/project-settings-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useFileTreeOpenContext } from '@/features/ide-react/context/file-tree-open-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import { createSegmenters } from '@/features/word-count-modal/utils/segmenters'
import { debugConsole } from '@/utils/debugging'
import { WORD_COUNT_OPEN_REQUESTED_EVENT } from '../selected-word-count-events'
import {
  countWordsInSelection,
  type SelectedWordCountResult,
} from '../utils/count-words-in-selection'
import { createSentenceSegmenter } from '../utils/sentence-segmenter'
import SelectedWordCountModal from './selected-word-count-modal'

type SelectedWordCountRequest = {
  doc: Text
  from: number
  to: number
}

export default function SelectedWordCountController() {
  const { spellCheckLanguage } = useProjectSettingsContext()
  const { view } = useEditorViewContext()
  const { showVisual } = useEditorPropertiesContext()
  const { openEntity, selectedEntityCount } = useFileTreeOpenContext()
  const { view: layoutView } = useLayoutContext()
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<SelectedWordCountRequest | null>(null)
  const [data, setData] = useState<SelectedWordCountResult | null>(null)
  const [error, setError] = useState(false)

  const segmenters = useMemo(() => {
    return createSegmenters(spellCheckLanguage?.replace(/_/, '-'))
  }, [spellCheckLanguage])

  const sentenceSegmenter = useMemo(() => {
    return createSentenceSegmenter(spellCheckLanguage?.replace(/_/, '-'))
  }, [spellCheckLanguage])

  const onClose = useCallback(() => {
    setOpen(false)
    setRequest(null)
  }, [])

  useEffect(() => {
    const handleOpenRequested = (event: Event) => {
      if (
        !view ||
        showVisual ||
        layoutView !== 'editor' ||
        selectedEntityCount !== 1 ||
        openEntity?.type !== 'doc'
      ) {
        return
      }

      const { doc, selection } = view.state
      const { from, to } = selection.main

      if (from >= to) {
        return
      }

      event.preventDefault()
      setRequest({ doc, from, to })
      setData(null)
      setError(false)
      setOpen(true)
    }

    window.addEventListener(
      WORD_COUNT_OPEN_REQUESTED_EVENT,
      handleOpenRequested
    )
    return () => {
      window.removeEventListener(
        WORD_COUNT_OPEN_REQUESTED_EVENT,
        handleOpenRequested
      )
    }
  }, [layoutView, openEntity, selectedEntityCount, showVisual, view])

  useEffect(() => {
    if (!open || !request) {
      return
    }

    try {
      const nextData = countWordsInSelection(
        request.doc.toString(),
        { from: request.from, to: request.to },
        segmenters,
        sentenceSegmenter
      )
      setData(nextData)
    } catch (error) {
      debugConsole.error(error)
      setError(true)
    }
  }, [open, request, segmenters, sentenceSegmenter])

  return (
    <SelectedWordCountModal
      show={open}
      onClose={onClose}
      data={data}
      error={error}
    />
  )
}
