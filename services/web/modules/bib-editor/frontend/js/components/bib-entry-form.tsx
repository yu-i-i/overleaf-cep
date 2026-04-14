/**
 * Form component for editing a single BibTeX entry's fields.
 * Adapted from the old bib-importer manual editor, cleaned up
 * for the new sidebar-panel style.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { BibEntry } from '../utils/bib-types'
import {
  ENTRY_TYPES,
  getEntryType,
  getFieldsForType,
} from '../utils/bib-types'
import { generateCitationKey } from '../utils/bib-parser'
import { fetchEntryFromDoi } from '../utils/doi-fetcher'

type Props = {
  entry: BibEntry
  onSave: (entry: BibEntry) => void
  onCancel: () => void
  isNew?: boolean
  /** IDs of all existing entries (to detect citation key collisions) */
  existingIds?: string[]
}

/** Human-readable labels for field names */
const FIELD_LABELS: Record<string, string> = {
  author: 'Author(s)',
  title: 'Title',
  journal: 'Journal',
  booktitle: 'Book Title',
  year: 'Year',
  month: 'Month',
  volume: 'Volume',
  number: 'Number / Issue',
  pages: 'Pages',
  publisher: 'Publisher',
  editor: 'Editor',
  school: 'School',
  institution: 'Institution',
  organization: 'Organization',
  series: 'Series',
  edition: 'Edition',
  chapter: 'Chapter',
  address: 'Address',
  howpublished: 'How Published',
  doi: 'DOI',
  url: 'URL',
  isbn: 'ISBN',
  issn: 'ISSN',
  keywords: 'Keywords',
  abstract: 'Abstract',
  note: 'Note',
  language: 'Language',
  file: 'File',
}

const LARGE_FIELDS = new Set(['abstract', 'note', 'keywords'])

export default function BibEntryForm({
  entry,
  onSave,
  onCancel,
  isNew = false,
  existingIds = [],
}: Props) {
  const { t } = useTranslation()
  const [type, setType] = useState(entry.type || 'article')
  const [id, setId] = useState(entry.id || '')
  const [fields, setFields] = useState<Record<string, string>>({
    ...entry.fields,
  })
  const [showAllFields, setShowAllFields] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // DOI fetch state
  const [doiInput, setDoiInput] = useState(entry.fields.doi || '')
  const [doiFetching, setDoiFetching] = useState(false)
  const [doiFetchError, setDoiFetchError] = useState<string | null>(null)
  const [doiFetchSuccess, setDoiFetchSuccess] = useState(false)

  const handleFetchDoi = useCallback(async () => {
    const rawDoi = doiInput.trim()
    if (!rawDoi) return
    setDoiFetching(true)
    setDoiFetchError(null)
    setDoiFetchSuccess(false)
    try {
      const fetched = await fetchEntryFromDoi(rawDoi)
      setType(fetched.type)
      setFields(prev => ({
        ...prev,
        ...fetched.fields,
        // keep existing DOI field consistent with what was typed
        doi: fetched.fields.doi || rawDoi,
      }))
      setDoiFetchSuccess(true)
    } catch (err) {
      setDoiFetchError(
        err instanceof Error ? err.message : 'Failed to fetch DOI'
      )
    } finally {
      setDoiFetching(false)
    }
  }, [doiInput])

  const entryTypeDef = getEntryType(type)
  const requiredFields = entryTypeDef?.requiredFields || []
  const optionalFields = entryTypeDef?.optionalFields || []

  // Show required fields + optional fields that have values, plus optionally all
  const visibleFields = showAllFields
    ? getFieldsForType(type)
    : [
        ...requiredFields,
        ...optionalFields.filter(f => fields[f]?.trim()),
      ]

  // Deduplicate
  const uniqueVisible = [...new Set(visibleFields)]

  const handleFieldChange = useCallback((name: string, value: string) => {
    setFields(prev => ({ ...prev, [name]: value }))
  }, [])

  const handleGenerateKey = useCallback(() => {
    const base = generateCitationKey(fields)
    // When editing, the current entry's own ID is not a collision
    const otherIds = new Set(
      isNew ? existingIds : existingIds.filter(eid => eid !== entry.id)
    )
    if (!otherIds.has(base)) {
      setId(base)
      return
    }
    // Append 'b', 'c', ... until we find a free key
    const suffixes = 'bcdefghijklmnopqrstuvwxyz'
    for (const ch of suffixes) {
      const candidate = `${base}${ch}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    // Fallback: numeric suffix
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}${n}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    setId(base) // give up, use base
  }, [fields, existingIds, isNew, entry.id])

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {}

    if (!id.trim()) {
      errs.id = t('Citation key is required')
    } else if (!/^[A-Za-z0-9_:.\-/]+$/.test(id)) {
      errs.id = t('Citation key contains invalid characters')
    }

    for (const f of requiredFields) {
      if (!fields[f]?.trim()) {
        errs[f] = t('{{field}} is required', { field: FIELD_LABELS[f] || f })
      }
    }

    if (fields.year && !/^\d{4}$/.test(fields.year.trim())) {
      errs.year = t('Year should be a 4-digit number')
    }

    if (fields.doi && !/^10\.\d{4,9}\/\S+$/.test(fields.doi.trim())) {
      errs.doi = t('DOI format looks invalid')
    }

    if (fields.url) {
      try {
        new URL(fields.url.trim())
      } catch {
        errs.url = t('URL looks invalid')
      }
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }, [id, fields, requiredFields, t])

  const handleSave = useCallback(() => {
    if (!validate()) return
    onSave({ type, id: id.trim(), fields })
  }, [type, id, fields, validate, onSave])

  return (
    <div className="bib-entry-form">
      {/* DOI import row */}
      <div className="bib-form-row">
        <label className="bib-form-label" htmlFor="bib-doi-import">
          {t('Import from DOI')}
        </label>
        <div className="bib-doi-row">
          <input
            id="bib-doi-import"
            className="form-control bib-form-input"
            value={doiInput}
            onChange={e => {
              setDoiInput(e.target.value)
              setDoiFetchSuccess(false)
              setDoiFetchError(null)
            }}
            placeholder="10.1038/s41586-021-03819-2"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleFetchDoi()
              }
            }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleFetchDoi()}
            disabled={doiFetching || !doiInput.trim()}
          >
            {doiFetching ? '…' : t('Fetch')}
          </button>
        </div>
        {doiFetchError && (
          <span className="bib-form-error">{doiFetchError}</span>
        )}
        {doiFetchSuccess && (
          <span className="bib-doi-success">{t('Fields populated from DOI')}</span>
        )}
      </div>

      <hr className="bib-form-divider" />

      {/* Entry type selector */}
      <div className="bib-form-row">
        <label className="bib-form-label" htmlFor="bib-type">
          {t('Type')}
        </label>
        <select
          id="bib-type"
          className="form-control bib-form-select"
          value={type}
          onChange={e => setType(e.target.value)}
        >
          {ENTRY_TYPES.map(et => (
            <option key={et.name} value={et.name}>
              @{et.name} — {et.label}
            </option>
          ))}
        </select>
      </div>

      {/* Citation key */}
      <div className="bib-form-row">
        <label className="bib-form-label" htmlFor="bib-key">
          {t('Citation Key')}
          {errors.id && (
            <span className="bib-form-error"> — {errors.id}</span>
          )}
        </label>
        <div className="bib-form-key-row">
          <input
            id="bib-key"
            className={`form-control bib-form-input ${errors.id ? 'bib-form-input-error' : ''}`}
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="e.g. smith2024"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleGenerateKey}
            title={t('Auto-generate from author/year')}
          >
            {t('Generate')}
          </button>
        </div>
      </div>

      {/* Entry fields */}
      {uniqueVisible.map(fieldName => (
        <div className="bib-form-row" key={fieldName}>
          <label
            className="bib-form-label"
            htmlFor={`bib-field-${fieldName}`}
          >
            {FIELD_LABELS[fieldName] || fieldName}
            {requiredFields.includes(fieldName) && (
              <span className="bib-form-required"> *</span>
            )}
            {errors[fieldName] && (
              <span className="bib-form-error"> — {errors[fieldName]}</span>
            )}
          </label>
          {LARGE_FIELDS.has(fieldName) ? (
            <textarea
              id={`bib-field-${fieldName}`}
              className={`form-control bib-form-textarea ${errors[fieldName] ? 'bib-form-input-error' : ''}`}
              value={fields[fieldName] || ''}
              onChange={e => handleFieldChange(fieldName, e.target.value)}
              rows={3}
            />
          ) : fieldName === 'author' ? (
            <AuthorField
              value={fields[fieldName] || ''}
              onChange={val => handleFieldChange(fieldName, val)}
              error={errors[fieldName]}
            />
          ) : (
            <input
              id={`bib-field-${fieldName}`}
              className={`form-control bib-form-input ${errors[fieldName] ? 'bib-form-input-error' : ''}`}
              value={fields[fieldName] || ''}
              onChange={e => handleFieldChange(fieldName, e.target.value)}
            />
          )}
        </div>
      ))}

      {/* Toggle optional fields */}
      <div className="bib-form-row">
        <button
          type="button"
          className="btn btn-link btn-sm bib-form-toggle"
          onClick={() => setShowAllFields(!showAllFields)}
        >
          {showAllFields
            ? t('Show fewer fields')
            : t('Show all fields')}
        </button>
      </div>

      {/* Action buttons */}
      <div className="bib-form-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
        >
          {isNew ? t('Add Entry') : t('Save Changes')}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCancel}
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}

/**
 * Author field with "and"-separated author management.
 * Internal state handles empty rows; only serializes non-empty authors to onChange.
 * Supports reordering via up/down buttons.
 */
function AuthorField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  const { t } = useTranslation()

  const parseAuthors = (v: string) =>
    v ? v.split(/\s+and\s+/i).map(a => a.trim()) : ['']

  // Maintain internal list (including empty in-progress rows)
  const [authors, setAuthors] = useState<string[]>(() => parseAuthors(value))

  // Sync when value changes from outside (e.g. DOI fetch, field reset)
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      setAuthors(parseAuthors(value))
    }
  }, [value])

  // Serialize non-empty authors back to the parent
  const commit = (list: string[]) => {
    const serialized = list.filter(a => a.trim()).join(' and ')
    onChange(serialized)
  }

  const setAuthorAt = (idx: number, val: string) => {
    const next = authors.map((a, i) => (i === idx ? val : a))
    setAuthors(next)
    commit(next)
  }

  const addAuthor = () => {
    // Just extend the internal list; don't commit (empty row has no content yet)
    setAuthors(prev => [...prev, ''])
  }

  const removeAuthor = (idx: number) => {
    const next = authors.length > 1 ? authors.filter((_, i) => i !== idx) : ['']
    setAuthors(next)
    commit(next)
  }

  const moveAuthor = (idx: number, dir: -1 | 1) => {
    const to = idx + dir
    if (to < 0 || to >= authors.length) return
    const next = [...authors]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    setAuthors(next)
    commit(next)
  }

  return (
    <div className="bib-author-field">
      {authors.map((a, i) => (
        <div key={i} className="bib-author-row">
          <input
            className={`form-control bib-form-input ${error ? 'bib-form-input-error' : ''}`}
            value={a}
            onChange={e => setAuthorAt(i, e.target.value)}
            placeholder={t('Last, First') || 'Last, First'}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm bib-author-move"
            onClick={() => moveAuthor(i, -1)}
            disabled={i === 0}
            title={t('Move up')}
          >
            ▲
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm bib-author-move"
            onClick={() => moveAuthor(i, 1)}
            disabled={i === authors.length - 1}
            title={t('Move down')}
          >
            ▼
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm bib-author-remove"
            onClick={() => removeAuthor(i)}
            title={t('Remove author')}
            disabled={authors.length === 1 && !a.trim()}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={addAuthor}
      >
        + {t('Add author')}
      </button>
    </div>
  )
}
