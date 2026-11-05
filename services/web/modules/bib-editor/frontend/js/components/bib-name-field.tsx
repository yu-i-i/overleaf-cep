/** Name-list editor with local invalid drafts and stable focus behavior. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
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

/** Resize an auto-growing field with a small height allowance. */
export const resizeTextarea = (textarea: HTMLTextAreaElement | null) => {
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight + 4}px`
}


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
  error?: boolean
  idPrefix?: string
}) {
  const { t } = useTranslation()
  const [nameDraft, setNameDraft] = useState<BibAuthorDraft>(
    () => initialDraft ?? createAuthorDraft(value)
  )
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

  const handleTextareaRef = useCallback((element: HTMLInputElement | null) => {
    const textarea = element as HTMLTextAreaElement | null
    resizeTextarea(textarea)
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

  const addName = () => {
    const current = nameDraftRef.current
    if (current.mode !== 'rows') return
    const filled = current.rows.filter(row => row.value.trim())
    if (filled.length >= MAX_AUTHOR_ROWS) {
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
    let index = rows.findIndex(row => !row.value.trim())
    if (index === -1) {
      index = rows.length
      rows.push({ value: '', saved: '' })
      rowIdsRef.current.push(nextRowIdRef.current++)
      focusNameIndexRef.current = index
    } else {
      focusNameIndexRef.current = null
      document.getElementById(inputId(index))?.focus()
    }
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

  const moveName = (index: number, direction: -1 | 1) => {
    const current = nameDraftRef.current
    if (current.mode !== 'rows') return
    const target = index + direction
    if (target < 0 || target >= current.rows.length) return
    const rows = current.rows.slice()
    const row = rows[index]
    rows[index] = rows[target]
    rows[target] = row
    const rowIds = rowIdsRef.current.slice()
    const rowId = rowIds[index]
    rowIds[index] = rowIds[target]
    rowIds[target] = rowId
    rowIdsRef.current = rowIds
    update({ mode: 'rows', rows }, 'input.complete')
  }

  if (nameDraft.mode === 'text') {
    return (
      <>
        <OLFormControl
          as="textarea"
          ref={handleTextareaRef}
          id={`${idPrefix}${fieldName}`}
          className={`bibtex-name-textarea bibtex-form-input ${error || !isAuthorDraftValid(nameDraft) ? 'is-invalid' : ''}`}
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
          onInput={event => resizeTextarea(event.currentTarget)}
        />
        {!isAuthorDraftValid(nameDraft) && (
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
      {nameDraft.rows.map((name, index) => (
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
            className={`bibtex-form-input ${error || !hasBalancedCurlyBraces(name.value) ? 'is-invalid' : ''}`}
            maxLength="128"
            type="text"
            id={inputId(index)}
            value={name.value}
            onChange={event => setNameAt(index, event.target.value)}
            placeholder="Doe, Jane"
          />

          {!hasBalancedCurlyBraces(name.value) && (
            <BibEntryFeedback message={t('curly_braces_must_be_balanced')} />
          )}

          <div className="bibtex-form-actions">
            <OLIconButton
              icon="arrow_upward"
              variant="ghost"
              accessibilityLabel={t('move_up')}
              onMouseDown={event => event.preventDefault()}
              onClick={() => moveName(index, -1)}
              disabled={index === 0}
            />
            <OLIconButton
              icon="arrow_downward"
              variant="ghost"
              accessibilityLabel={t('move_down')}
              onMouseDown={event => event.preventDefault()}
              onClick={() => moveName(index, +1)}
              disabled={index === nameDraft.rows.length - 1}
            />
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
      ))}
      <OLTooltip
        key={`tooltip-add-${fieldName}`}
        id={`${idPrefix}tooltip-add-${fieldName}`}
        description={t('add_name', { name: fieldName })}
        overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
      >
        <OLButton
          leadingIcon="add"
          variant="secondary"
          size="sm"
          className="bibtex-name-add"
          onMouseDown={event => event.preventDefault()}
          onClick={addName}
          aria-label={t('add_name', { name: fieldName })}
        />
      </OLTooltip>
    </div>
  )
}
