import React, { useCallback, useEffect, useState } from 'react'
import ReferencePickerModal from './reference-picker-modal'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'

export default function ReferencePickerController() {
  const { view } = useEditorViewContext()

  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [braceFrom, setBraceFrom] = useState<number | null>(null)
  const [braceTo, setBraceTo] = useState<number | null>(null)
  const [initialKeys, setInitialKeys] = useState<string[]>([])

  const onClose = useCallback(() => setOpen(false), [])

  const onApply = useCallback(
    (selectedKeys: string[]) => {
      if (!view || from == null || to == null) return
      let insert = selectedKeys.join(', ')

      // Smart separator handling for cursor-only insertion (from === to)
      if (from === to && insert.length > 0) {
        const bFrom = braceFrom ?? from
        const bTo = braceTo ?? to
        // Add ", " before inserted keys if adjacent to existing content
        if (from > bFrom) {
          const charBefore = view.state.doc.sliceString(from - 1, from)
          if (!/[,\s]/.test(charBefore)) {
            insert = ', ' + insert
          }
        }
        // Add ", " after inserted keys if adjacent to existing content
        if (to < bTo) {
          const charAfter = view.state.doc.sliceString(to, to + 1)
          if (!/[,\s]/.test(charAfter)) {
            insert = insert + ', '
          }
        }
      }

      view.dispatch({ changes: { from, to, insert } })
      view.focus()
    },
    [view, from, to, braceFrom, braceTo]
  )

  useEffect(() => {
    const handler = (evt: CustomEvent) => {
      const detail = evt.detail || {}

      if (detail.insertFrom == null) {
        // Not inside a cite — insert \cite{} and open modal
        if (!view) return
        const pos = view.state.selection.main.head
        const insertText = '\\cite{}'
        view.dispatch({
          changes: { from: pos, to: pos, insert: insertText },
        })
        const newFrom = pos + insertText.indexOf('{') + 1
        setFrom(newFrom)
        setTo(newFrom)
        setBraceFrom(newFrom)
        setBraceTo(newFrom)
        setInitialKeys([])
      } else {
        setFrom(detail.insertFrom)
        setTo(detail.insertTo)
        setBraceFrom(detail.braceFrom ?? detail.insertFrom)
        setBraceTo(detail.braceTo ?? detail.insertTo)
        setInitialKeys(detail.selectedTokens || [])
      }

      setOpen(true)
    }

    window.addEventListener('reference:openPicker', handler as EventListener)
    return () =>
      window.removeEventListener(
        'reference:openPicker',
        handler as EventListener
      )
  }, [view])

  return (
    <ReferencePickerModal
      show={open}
      onClose={onClose}
      onApply={onApply}
      initialKeys={initialKeys}
    />
  )
}
