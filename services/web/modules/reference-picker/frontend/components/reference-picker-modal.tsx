import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { useReferencesContext } from '@/features/ide-react/context/references-context'
import Tag from '@/shared/components/tag'
import { useTranslation } from 'react-i18next'
import type { Bib2JsonEntry } from '@/features/ide-react/references/types'

type FocusArea = 'search' | 'list' | 'footer'

const SEARCH_FIELD_OPTIONS = [
  { label: 'Author', value: 'author' },
  { label: 'Title', value: 'title' },
  { label: 'Year', value: 'year' },
  { label: 'Journal', value: 'journal' },
  { label: 'Key', value: 'EntryKey' },
] as const

const DEFAULT_FIELDS = ['author', 'title', 'year', 'journal', 'EntryKey']

function matchesFields(
  entry: Bib2JsonEntry,
  query: string,
  fields: string[]
): boolean {
  const q = query.toLowerCase()
  const noFilter = fields.length === 0
  if ((noFilter || fields.includes('EntryKey')) && entry.EntryKey.toLowerCase().includes(q)) return true
  const f = entry.Fields
  if ((noFilter || fields.includes('title')) && f.title?.toLowerCase().includes(q)) return true
  if ((noFilter || fields.includes('author')) && f.author?.toLowerCase().includes(q)) return true
  if ((noFilter || fields.includes('journal')) && f.journal?.toLowerCase().includes(q)) return true
  if ((noFilter || fields.includes('year')) && f.year?.toLowerCase().includes(q)) return true
  return false
}

export default function ReferencePickerModal({
  show,
  onClose,
  onApply,
  initialKeys,
}: {
  show: boolean
  onClose: () => void
  onApply: (selectedKeys: string[]) => void
  initialKeys: string[]
}) {
  const { t } = useTranslation()
  const { searchLocalReferences } = useReferencesContext()

  const [query, setQuery] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])

  const [results, setResults] = useState<{ _source: Bib2JsonEntry }[]>([])
  const [selectedFields, setSelectedFields] =
    useState<string[]>(DEFAULT_FIELDS)

  // Ref holding initial key tokens that still need to be matched against
  // actual bib entries once the first search completes.
  const pendingInitialKeysRef = useRef<string[]>([])

  // Reset state and load fresh entries every time the modal opens
  const [openCount, setOpenCount] = useState(0)
  useEffect(() => {
    if (show) {
      setQuery('')
      setSelectedKeys([])
      setResults([])
      pendingInitialKeysRef.current = [...initialKeys]
      setOpenCount(c => c + 1)
    }
  }, [show, initialKeys])

  useEffect(() => {
    if (!show) return
    let cancelled = false

    const perform = async () => {
      // The module's enhanced index handles empty query as "list all"
      const r = await searchLocalReferences(query.trim() || '')
      if (cancelled) return

      // Apply field filtering client-side
      if (query.trim() && selectedFields.length > 0 && selectedFields.length < DEFAULT_FIELDS.length) {
        setResults(r.hits.filter(h => matchesFields(h._source, query.trim(), selectedFields)))
      } else {
        setResults(r.hits)
      }

      // Match pending initial keys (from selection) against known bib keys
      if (pendingInitialKeysRef.current.length > 0) {
        const knownKeys = new Set(r.hits.map(h => h._source.EntryKey))
        const matched = pendingInitialKeysRef.current.filter(k =>
          knownKeys.has(k)
        )
        if (matched.length > 0) {
          setSelectedKeys(matched)
        }
        pendingInitialKeysRef.current = []
      }
    }

    perform()
    return () => {
      cancelled = true
    }
    // openCount ensures a fresh search on every modal open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchLocalReferences, selectedFields, show, openCount])

  const filteredKeys = useMemo(
    () => results.map(r => r._source.EntryKey),
    [results]
  )

  const [focusArea, setFocusArea] = useState<FocusArea>('search')
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const footerRef = useRef<HTMLDivElement | null>(null)

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys(prev =>
      prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
    )
  }, [])

  const handleApply = useCallback(() => {
    onApply(selectedKeys)
    onClose()
  }, [selectedKeys, onApply, onClose])

  useEffect(() => {
    if (show) {
      setTimeout(() => searchRef.current?.focus(), 0)
      setFocusArea('search')
      setFocusedIndex(null)
    }
  }, [show])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (focusArea === 'search') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setFocusArea('list')
          setFocusedIndex(0)
        }
      } else if (focusArea === 'list') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setFocusedIndex(prev =>
            prev == null ? 0 : Math.min(filteredKeys.length - 1, prev + 1)
          )
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setFocusedIndex(prev =>
            prev == null ? 0 : Math.max(0, prev - 1)
          )
        } else if (event.key === ' ') {
          event.preventDefault()
          if (focusedIndex != null && filteredKeys[focusedIndex]) {
            toggleKey(filteredKeys[focusedIndex])
          }
        } else if (event.key === 'Enter') {
          event.preventDefault()
          handleApply()
        }
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        const areas: FocusArea[] = ['search', 'list', 'footer']
        const currentIdx = areas.indexOf(focusArea)
        const nextIdx = event.shiftKey
          ? (currentIdx - 1 + areas.length) % areas.length
          : (currentIdx + 1) % areas.length
        const nextArea = areas[nextIdx]
        setFocusArea(nextArea)
        if (nextArea === 'list') {
          setFocusedIndex(0)
        } else if (nextArea === 'search') {
          setFocusedIndex(null)
          setTimeout(() => searchRef.current?.focus(), 0)
        } else {
          setFocusedIndex(null)
          setTimeout(
            () => footerRef.current?.querySelector('button')?.focus(),
            0
          )
        }
      }
    },
    [focusArea, focusedIndex, filteredKeys, toggleKey, handleApply]
  )

  useEffect(() => {
    if (focusArea === 'list' && focusedIndex !== null) {
      const el = document.getElementById(
        `reference-picker-item-${focusedIndex}`
      )
      if (el) {
        el.focus()
        searchRef.current?.setAttribute('aria-activedescendant', el.id)
      }
    }
    if (focusArea !== 'list') {
      searchRef.current?.removeAttribute('aria-activedescendant')
    }
  }, [focusArea, focusedIndex])

  const toggleField = useCallback((value: string) => {
    setSelectedFields(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }, [])

  return (
    <OLModal show={show} onHide={onClose} size="lg">
      <OLModalHeader>
        <OLModalTitle data-testid="reference-picker-title">
          {t('references_picker_title')}
        </OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <div onKeyDown={onKeyDown} className="reference-picker">
          <input
            aria-label={t('search_references')}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            ref={searchRef}
            className="form-control"
            data-testid="reference-picker-search"
          />

          <div className="search-selectors">
            {SEARCH_FIELD_OPTIONS.map(s => (
              <label key={s.value} className="search-selector-label">
                <input
                  type="checkbox"
                  checked={selectedFields.includes(s.value)}
                  onChange={() => toggleField(s.value)}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>

          <div
            className="selected-chips"
            data-testid="reference-picker-selected-chips"
          >
            {selectedKeys.map(key => (
              <Tag key={key} closeBtnProps={{ onClick: () => toggleKey(key) }}>
                {key}
              </Tag>
            ))}
          </div>

          <div
            role="listbox"
            aria-label={t('reference_search_results')}
            id="reference-picker-list"
            data-testid="reference-picker-list"
          >
            {results.length === 0 ? (
              <div
                className="reference-picker-empty"
                data-testid="reference-picker-empty"
              >
                {t('references_picker_empty_hint')}
              </div>
            ) : (
              results.map((hit, index) => {
                const key = hit._source.EntryKey
                const { title = '', author = '', year = '', journal = '' } =
                  hit._source.Fields ?? {}
                const meta = [
                  author,
                  author && year ? ` — ${year}` : year,
                  journal ? ` · ${journal}` : '',
                ].join('')

                return (
                  <label
                    id={`reference-picker-item-${index}`}
                    key={key}
                    className={`d-block ${focusedIndex === index ? 'focused' : ''}`}
                    role="option"
                    aria-selected={selectedKeys.includes(key)}
                    tabIndex={0}
                    onClick={() => setFocusedIndex(index)}
                    data-entry-key={key}
                    data-testid={`reference-picker-item-${key}`}
                  >
                    <div className="hit-head">
                      <input
                        type="checkbox"
                        checked={selectedKeys.includes(key)}
                        onChange={() => toggleKey(key)}
                      />
                      <span className="hit-key">{key}</span>
                    </div>
                    <div className="hit-main">
                      <span className="hit-title">{title}</span>
                      <span className="hit-meta">{meta}</span>
                    </div>
                  </label>
                )
              })
            )}
          </div>
        </div>
      </OLModalBody>
      <OLModalFooter>
        <div ref={footerRef}>
          <OLButton variant="secondary" onClick={onClose}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={handleApply}
            data-testid="reference-picker-insert"
          >
            {t('insert')}
          </OLButton>
        </div>
      </OLModalFooter>
    </OLModal>
  )
}
