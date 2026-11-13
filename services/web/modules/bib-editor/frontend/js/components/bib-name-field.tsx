/** Name-list editor with local invalid drafts and stable focus behavior. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormText from '@/shared/components/ol/ol-form-text'
import BibEntryFeedback from './bib-entry-feedback'
import { fieldLabel } from '../utils/bib-field-labels'
import { hasBalancedCurlyBraces } from '../utils/bib-validate'
import { fromBibFormString, toBibFormString } from '../utils/bib-field-edit'
import {
  authorDraftSavedValue,
  authorDraftValue,
  authorSourceValue,
  createAuthorDraft,
  isAuthorDraftValid,
  MAX_AUTHOR_ROWS,
} from '../utils/bib-author-draft'
import type { BibAuthorDraft } from '../utils/bib-author-draft'
import type { BibHistoryUserEvent } from '../context/bib-editor-context'

/**
 * Name-list inputs and the raw text editor share one draft model. An invalid name
 * never blocks writes of valid neighboring rows: each row retains its own last
 * writable value. Switching to text mode preserves the last writable combined
 * value without trying to split malformed BibTeX back into rows.
 */
export default function BibNameField({
  fieldName,
  value,
  initialDraft,
  onChange,
  error,
  hideBraceErrors,
  onDraggingChange,
  idPrefix = '',
}: {
  fieldName: string
  value: string
  initialDraft?: BibAuthorDraft
  onChange: (
    value: string,
    historyUserEvent?: BibHistoryUserEvent,
    fieldIsValid?: boolean,
    draft?: BibAuthorDraft
  ) => void
  hideBraceErrors: boolean
  onDraggingChange: (dragging: boolean) => void
  error?: boolean
  idPrefix?: string
}) {
  const { t } = useTranslation()
  const [nameDraft, setNameDraft] = useState<BibAuthorDraft>(
    () => initialDraft ?? createAuthorDraft(value)
  )
  const press = useRef<{ index: number; pointer: number; y: number; centerOffset: number; textOffset: number } | null>(null)
  const [drag, setDrag] = useState<{ from: number; to: number; x: number; y: number } | null>(null)
  const dragging = drag !== null
  useLayoutEffect(() => {
    if (!dragging) return
    onDraggingChange(true)
    return () => onDraggingChange(false)
  }, [dragging, onDraggingChange])

  const nameDraftRef = useRef(nameDraft)
  // The parent supplies canonical BibTeX field text. Track the canonical value
  // of our last edit so its echo is not mistaken for an external source change.
  const expectedValueRef = useRef(value)
  const focusTextEndRef = useRef(false)
  const focusNameIndexRef = useRef<number | null>(null)
  // Keep DOM row identity with the person when names are reordered, rather
  // than with the array index. These IDs are local UI state, not BibTeX data.
  const rowIdsRef = useRef<number[]>(
    nameDraft.mode === 'rows' ? nameDraft.rows.map((_, index) => index) : []
  )
  const nextRowIdRef = useRef(rowIdsRef.current.length)
  // Match the label target in both row and textarea modes.
  const inputId = (index: number) => `${idPrefix}${fieldName}${index ? `-${index}` : ''}`

  const handleTextareaMount = useCallback((textarea: HTMLInputElement | null) => {
    if (!textarea || !focusTextEndRef.current) return
    focusTextEndRef.current = false
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  // Keep the user's exact spelling (including a single, unfinished '#') when
  // CodeMirror returns the canonical representation of our own edit. Only a
  // different source value replaces the local name draft.
  useEffect(() => {
    if (value === expectedValueRef.current) return
    press.current = null
    setDrag(null)
    const next = createAuthorDraft(value)
    if (next.mode === 'rows') {
      rowIdsRef.current = next.rows.map((_, index) =>
        rowIdsRef.current[index] ?? nextRowIdRef.current++
      )
    } else {
      rowIdsRef.current = []
    }
    expectedValueRef.current = value
    nameDraftRef.current = next
    setNameDraft(next)
  }, [value])

  const update = (
    next: BibAuthorDraft,
    historyUserEvent: BibHistoryUserEvent = 'input.type'
  ) => {
    nameDraftRef.current = next
    setNameDraft(next)
    const text = authorDraftValue(next)
    expectedValueRef.current = text.trim()
      ? toBibFormString(fromBibFormString(text, fieldName), fieldName)
      : ''
    onChange(text, historyUserEvent, isAuthorDraftValid(next), next)
  }

  const setNameAt = (index: number, value: string) => {
    const current = nameDraftRef.current
    if (current.mode !== 'rows') return
    update({
      mode: 'rows',
      rows: current.rows.map((row, i) =>
        i === index
          ? {
              value,
              saved: hasBalancedCurlyBraces(value)
                ? authorSourceValue(value, row.saved)
                : row.saved,
            }
          : row
      ),
    })
  }

  const addName = (after: number) => {
    const current = nameDraftRef.current
    if (current.mode !== 'rows') return
    if (current.rows.length >= MAX_AUTHOR_ROWS) {
      // Mode is a presentation choice, not a validation result. Retain the
      // writable projection while showing the entire (possibly invalid) text.
      focusNameIndexRef.current = null
      focusTextEndRef.current = true
      rowIdsRef.current = []
      update({
        mode: 'text',
        value: authorDraftValue(current),
        saved: authorDraftSavedValue(current),
        invalidRow: current.rows.find(
          row => !hasBalancedCurlyBraces(row.value)
        )?.value,
      }, 'input.complete')
      return
    }

    const rows = current.rows.slice()
    const index = after + 1
    rows.splice(index, 0, { value: '', saved: '' })
    rowIdsRef.current.splice(index, 0, nextRowIdRef.current++)
    focusNameIndexRef.current = index
    update({ mode: 'rows', rows }, 'input.complete')
  }

  const removeName = (index: number) => {
    const current = nameDraftRef.current
    if (current.mode !== 'rows') return
    rowIdsRef.current = current.rows.length > 1
      ? rowIdsRef.current.filter((_, i) => i !== index)
      : [rowIdsRef.current[0]]
    update({
      mode: 'rows',
      rows: current.rows.length > 1
        ? current.rows.filter((_, i) => i !== index)
        : [{ value: '', saved: '' }],
    }, 'input.complete')
  }

  const moveName = (index: number, target: number) => {
    const current = nameDraftRef.current
    if (current.mode !== 'rows' || index < 0 || index === target ||
        target < 0 || target >= current.rows.length) return
    const rows = current.rows.slice()
    const [row] = rows.splice(index, 1)
    rows.splice(target, 0, row)
    const ids = rowIdsRef.current
    const [id] = ids.splice(index, 1)
    ids.splice(target, 0, id)
    update({ mode: 'rows', rows }, 'input.complete')
  }

  function endDrag() {
    press.current = null
    setDrag(null)
  }

  function targetIndex(handle: HTMLElement, centerY: number) {
    const list = handle.closest('.bibtex-name-rows')!
    let nearest = 0
    let distance = Infinity
    list.querySelectorAll('.bibtex-name-handle').forEach((slot, index) => {
      const rect = slot.getBoundingClientRect()
      const delta = Math.abs(centerY - (rect.top + rect.height / 2))
      if (delta < distance) {
        nearest = index
        distance = delta
      }
    })
    return nearest
  }

  if (nameDraft.mode === 'text') {
    return (
      <>
        <OLFormControl
          as="textarea"
          ref={handleTextareaMount}
          id={`${idPrefix}${fieldName}`}
          className={`bibtex-auto-textarea bibtex-name-textarea bibtex-form-input ${error || (!hideBraceErrors && !isAuthorDraftValid(nameDraft)) ? 'is-invalid' : ''}`}
          maxLength="4096"
          autoComplete="off"
          value={nameDraft.value}
          onChange={event => {
            const text = event.target.value
            update({
              mode: 'text',
              value: text,
              saved: hasBalancedCurlyBraces(text) ? text : nameDraft.saved,
            })
          }}
          placeholder="Doe, Jane and Mustermann, Max"
          rows={1}
        />
        {!hideBraceErrors && !isAuthorDraftValid(nameDraft) && (
          <BibEntryFeedback
            message={t('curly_braces_must_be_balanced')}
          />
        )}
        <OLFormText>{t('separate_multiple_names_with_and')}</OLFormText>
      </>
    )
  }

  return (
    <div className="bibtex-form-names">
      <div className="bibtex-name-rows">
        {nameDraft.rows.map((name, index) => {
          // Preview the name order in the existing input slots.
          let displayed = name
          if (drag) {
            if (index === drag.to) displayed = { value: '', saved: '' }
            else if (index >= drag.from && index < drag.to) displayed = nameDraft.rows[index + 1]
            else if (index <= drag.from && index > drag.to) displayed = nameDraft.rows[index - 1]
          }
          return (
            <div key={rowIdsRef.current[index]} className="bibtex-field-with-actions">
              <OLFormControl
                ref={
                  focusNameIndexRef.current === index
                    ? element => {
                        if (!element) return
                        focusNameIndexRef.current = null
                        element.focus()
                      }
                    : undefined
                }
                className={`bibtex-form-input ${error || (!hideBraceErrors && !hasBalancedCurlyBraces(displayed.value)) ? 'is-invalid' : ''}`}
                maxLength="128"
                type="text"
                id={inputId(index)}
                value={displayed.value}
                onChange={event => setNameAt(index, event.target.value)}
                placeholder={drag?.to === index ? '' : 'Doe, Jane'}
                prepend={
                  <OLIconButton
                    type="button"
                    icon="drag_indicator"
                    className="bibtex-name-handle"
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={`${t('move_up')} / ${t('move_down')}: ${name.value}`}
                    disabled={nameDraft.rows.length < 2 || !name.value.trim()}
                    onPointerDown={event => {
                      if (!event.isPrimary || event.button !== 0 || event.currentTarget.matches(':disabled')) return
                      const handle = event.currentTarget
                      const rect = handle.getBoundingClientRect()
                      const input = handle.closest('.bibtex-field-with-actions')!.querySelector('input')!
                      const textLeft = input.getBoundingClientRect().left + input.clientLeft +
                        parseFloat(getComputedStyle(input).paddingLeft)
                      press.current = { index, pointer: event.pointerId, y: event.clientY,
                        centerOffset: rect.top + rect.height / 2 - event.clientY,
                        textOffset: textLeft - event.clientX }
                      handle.setPointerCapture(event.pointerId)
                    }}
                    onPointerMove={event => {
                      const start = press.current
                      if (!start || start.index !== index || start.pointer !== event.pointerId) return
                      if (!drag && Math.abs(event.clientY - start.y) < 3) return
                      const y = event.clientY + start.centerOffset
                      setDrag({ from: index, to: targetIndex(event.currentTarget, y),
                        x: event.clientX + start.textOffset, y })
                    }}
                    onPointerUp={event => {
                      const start = press.current
                      if (!start || start.pointer !== event.pointerId) return
                      const list = event.currentTarget.closest('.bibtex-name-rows')!
                      if (drag && list.contains(document.elementFromPoint(event.clientX, event.clientY))) {
                        moveName(index, targetIndex(event.currentTarget, event.clientY + start.centerOffset))
                      }
                      endDrag()
                    }}
                    onLostPointerCapture={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={event => {
                      if (event.key === 'Escape') endDrag()
                      if (press.current || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                      event.preventDefault()
                      moveName(index, index + (event.key === 'ArrowUp' ? -1 : 1))
                    }}
                  />
                }
                append={
                  <OLIconButton
                    type="button"
                    icon="add"
                    className="bibtex-name-add"
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={t('add_name', { name: fieldName })}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => addName(index)}
                  />
                }
              />

              {!hideBraceErrors && !hasBalancedCurlyBraces(displayed.value) && (
                <BibEntryFeedback message={t('curly_braces_must_be_balanced')} />
              )}

              <div className="bibtex-form-actions">
                <OLIconButton
                  icon="close"
                  unfilled
                  variant="ghost"
                  accessibilityLabel={fieldName === 'author'
                    ? t('remove_author')
                    : t('remove_field', { a: fieldLabel(fieldName) })}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => removeName(index)}
                  disabled={nameDraft.rows.length === 1 && !name.value.trim()}
                />
              </div>
            </div>
          )
        })}
        {drag && createPortal(
          <span aria-hidden="true" className="bibtex-dragged-name"
            style={{ left: drag.x, top: drag.y }}>
            {nameDraft.rows[drag.from]?.value}
          </span>,
          document.body
        )}
      </div>
    </div>
  )
}
