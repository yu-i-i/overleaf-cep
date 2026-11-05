/**
 * Two-stage BibTeX/DOI import. Pasted entries appear immediately; DOI lookups
 * fill their rows concurrently without changing paste order. Closing or
 * restarting the preview invalidates outstanding results through a generation
 * counter. Import commits the selected valid entries in one guarded write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { plural } from '../utils/plural'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { fetchEntryFromDoi } from '../utils/doi-fetcher'
import { generateCitationKey } from '../utils/bib-key-generation'
import { translateBibSourceDiagnostic } from '../utils/bib-entry-diagnostics'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import {
  splitImportText,
  buildImportRow,
  buildImportRows,
  type BibImportRow,
} from '../utils/bib-import.ts'

type Props = {
  show: boolean
  /** Fired for the Import button; false means the guarded write was rejected. */
  onImport: (entries: BibtexEntry[]) => Promise<boolean>
  onHidden: () => void
  /** Library (SaaS): pre-fill the paste step (Upload .bib file → same
   *  pipeline). Default empty string. */
  initialText?: string
}

export default function BibImportModal({
  show,
  onImport,
  onHidden,
  initialText = '',
}: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'paste' | 'preview'>('paste')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<BibImportRow[]>([])
  const [checkedRowIds, setCheckedRowIds] = useState<string[]>([])
  const [previewDone, setPreviewDone] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFailed, setImportFailed] = useState(false)
  const previewGenerationRef = useRef(0)

  // Reset to a fresh "Add reference" → paste step whenever the modal opens.
  // `show` is the only remount signal (the component stays mounted to
  // follow the OLModal show/hide contract).
  useEffect(() => {
    // Invalidate queued DOI work whenever the modal becomes hidden. Requests
    // already in flight may finish, but their results will no longer update UI.
    previewGenerationRef.current++
    if (!show) return

    setMode('paste')
    setText(initialText)
    setRows([])
    setCheckedRowIds([])
    setPreviewDone(false)
    setImporting(false)
    setImportFailed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const handleHidden = useCallback(() => {
    previewGenerationRef.current++
    onHidden()
  }, [onHidden])

  const handlePreview = useCallback(async () => {
    if (!text.trim()) return

    const generation = ++previewGenerationRef.current
    setMode('preview')
    setImportFailed(false)
    setPreviewDone(false)
    setCheckedRowIds([])
    setRows([])

    const items = splitImportText(text)
    type DoiItem = Extract<(typeof items)[number], { kind: 'doi' }>
    const doiItems: Array<{ item: DoiItem; rowIndex: number }> = []
    items.forEach((item, rowIndex) => {
      if (item.kind === 'doi') {
        doiItems.push({ item, rowIndex })
      }
    })
    const doiResults: (string | BibtexEntry | undefined)[] = doiItems.map(() => undefined)

    // Prepare ordinary BibTeX rows once. DOI completions only rebuild their own
    // row instead of reparsing every pasted BibTeX entry on each network result.
    const previewRows = buildImportRows(items, doiResults)
    setRows([...previewRows])
    // Select available BibTeX rows by default, once. Subsequent DOI results
    // must never replace choices the user has already made.
    setCheckedRowIds(previewRows
      .filter(row => row.status === 'ok' || row.status === 'doi-ok')
      .map(row => row.rowId))

    // DOI lookups are independent. Run a small bounded worker pool rather than
    // serial requests, while writing results at their original DOI index so
    // preview rows remain in paste order.
    const DOI_FETCH_CONCURRENCY = 4
    let nextDoiIndex = 0
    const fetchNextDoi = async () => {
      while (generation === previewGenerationRef.current) {
        const workIndex = nextDoiIndex++
        if (workIndex >= doiItems.length) return
        const { item, rowIndex } = doiItems[workIndex]

        let result: string | BibtexEntry
        try {
          const fetched = await fetchEntryFromDoi(item.raw)
          const fetchedEntry = fetched.entry
          result = fetchedEntry.key
            ? fetchedEntry
            : fetchedEntry.setKey(generateCitationKey(fetchedEntry))
        } catch (err) {
          result = err instanceof Error ? err.message : 'failed_to_fetch_doi'
        }
        if (generation !== previewGenerationRef.current) return
        const row = buildImportRow(item, rowIndex, result)
        previewRows[rowIndex] = row
        setRows([...previewRows])
        if (row.status === 'doi-ok') {
          setCheckedRowIds(previous => previous.includes(row.rowId)
            ? previous
            : [...previous, row.rowId])
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(DOI_FETCH_CONCURRENCY, doiItems.length) },
        () => fetchNextDoi()
      )
    )

    if (generation !== previewGenerationRef.current) return
    setPreviewDone(true)
  }, [text])

  const importable = useMemo(
    () => rows.filter(r => r.status === 'ok' || r.status === 'doi-ok'),
    [rows]
  )
  const checkedRowIdsSet = useMemo(() => new Set(checkedRowIds), [checkedRowIds])
  const checkedCount = checkedRowIds.length

  const toggleRow = useCallback((rowId: string) => {
    setCheckedRowIds(prev =>
      prev.includes(rowId) ? prev.filter(id => id !== rowId) : [...prev, rowId]
    )
  }, [])

  const handleToggleSelectAll = useCallback((checked: boolean) => {
    setCheckedRowIds(checked ? importable.map(r => r.rowId) : [])
  }, [importable])

  const handleImport = useCallback(async () => {
    if (importing) return
    const entries = importable
      .filter(r => checkedRowIdsSet.has(r.rowId))
      .map(r => r.entry as BibtexEntry)
    if (entries.length === 0) return

    setImporting(true)
    setImportFailed(false)
    try {
      const saved = await onImport(entries)
      if (saved) handleHidden()
      else setImportFailed(true)
    } catch (error) {
      console.error('BibTeX import failed', error)
      setImportFailed(true)
    } finally {
      setImporting(false)
    }
  }, [checkedRowIdsSet, importable, importing, handleHidden, onImport])

  // Navigation controls for the two import stages:
  //  - empty state (`bibtex-import-preview-empty`) when the paste yields
  //    nothing importable (previewDone + zero importable rows)
  //  - footer-warning when nothing is checked (Import shows why it's idle)
  const previewEmpty = previewDone && rows.length === 0

  return (
    <OLModal
      data-bib-editor-dialog
      show={show}
      onHide={handleHidden}
      themed
      scrollable
    >
      <OLModalHeader>
        {mode === 'preview' ? (
          <>
            {/* Keep the stage heading available to screen readers. */}
            <OLButton
              className="ps-1"
              variant="ghost"
              leadingIcon="arrow_back"
              aria-label={t('back')}
              onClick={() => {
                previewGenerationRef.current++
                setMode('paste')
              }}
            >
              {t('back')}
            </OLButton>
            <OLModalTitle className="visually-hidden">{t('preview')}</OLModalTitle>
          </>
        ) : (
          <OLModalTitle>{t('add_reference')}</OLModalTitle>
        )}
      </OLModalHeader>

      {mode === 'paste' ? (
        <>
          <OLModalBody className="bibtex-import-form">
            <div className="form-group">
              <OLFormLabel htmlFor="bib-import-textarea">
                {t('reference')}
              </OLFormLabel>
              <OLFormControl
                as="textarea"
                id="bib-import-textarea"
                className="bibtex-import-textarea form-control"
                rows={6}
                value={text}
                onChange={e => setText(e.target.value)}
                aria-describedby="bib-import-help"
              />
              <div className="form-text" id="bib-import-help">
                <span className="form-text-inner">
                  <span>
                    {t('paste_bibtex_or_dois_here')}
                  </span>
                </span>
              </div>
            </div>
          </OLModalBody>
          <OLModalFooter>
            <OLButton variant="secondary" onClick={handleHidden}>
              {t('cancel')}
            </OLButton>
            <OLButton
              variant="primary"
              disabled={text.trim() === ''}
              onClick={() => void handlePreview()}
              type="button"
            >
              {t('preview')}
            </OLButton>
          </OLModalFooter>
        </>
      ) : (
        <>
          <OLModalBody>
            {previewEmpty ? (
              <div className="bibtex-import-preview-empty">
                {t('no_references_found')}
              </div>
            ) : (
              <>
                <div className="bibtex-import-preview-header">
                  <div
                    className="wide-target-checkbox bibtex-import-preview-check-all"
                  >
                    <span className="wide-target-checkbox-box">
                      <div className="form-checkbox">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          aria-label={t('select_all')}
                          checked={
                            importable.length > 0 &&
                            importable.every(r => checkedRowIdsSet.has(r.rowId))
                          }
                          disabled={importable.length === 0 || !previewDone}
                          onChange={e => handleToggleSelectAll(e.target.checked)}
                        />
                      </div>
                      <label className="wide-target-checkbox-target" aria-hidden="true"></label>
                    </span>
                  </div>
                  <div className="bibtex-import-preview-count">
                    {`${importable.length} ${plural(t, importable.length, 'reference', 'references')}`}
                  </div>
                </div>
                <div className="bibtex-import-preview-list">
                  {rows.map(row => (
                    <BibImportCard
                      key={row.rowId}
                      row={row}
                      checked={checkedRowIdsSet.has(row.rowId)}
                      onToggle={toggleRow}
                      t={t}
                    />
                  ))}
                </div>
              </>
            )}
          </OLModalBody>
          <OLModalFooter>
            <div className="bibtex-import-preview-footer">
              {importFailed && (
                <div className="bibtex-import-preview-footer-warning" role="alert">
                  <span aria-hidden="true" className="material-symbols unfilled">error</span>
                  <span>{t('could_not_import_this_reference')}</span>
                </div>
              )}
              {previewDone && checkedCount === 0 && importable.length > 0 && !previewEmpty && (
                <div className="bibtex-import-preview-footer-warning" role="alert">
                  <span aria-hidden="true" className="material-symbols unfilled">error</span>
                  <span>{t('select_reference')}</span>
                </div>
              )}
              <div className="bibtex-import-preview-footer-actions">
                {!previewEmpty && (
                  <div className="bibtex-import-preview-footer-count">
                    {`${checkedCount} ${plural(t, checkedCount, 'reference', 'references')}`}
                  </div>
                )}
                <div className="bibtex-import-preview-footer-buttons">
                  <OLButton variant="secondary" onClick={handleHidden}>
                    {t('cancel')}
                  </OLButton>
                  <OLButton
                    variant="primary"
                    disabled={previewEmpty || !previewDone || checkedCount === 0 || importing}
                    onClick={() => void handleImport()}
                  >
                    {importing ? '…' : t('save')}
                  </OLButton>
                </div>
              </div>
            </div>
          </OLModalFooter>
        </>
      )}
    </OLModal>
  )
}

function BibImportCard({
  row,
  checked,
  onToggle,
  t,
}: {
  row: BibImportRow
  checked: boolean
  onToggle: (rowId: string) => void
  t: TFunction
}) {
  const selectable = row.status === 'ok' || row.status === 'doi-ok'

  return (
    <div className="bibtex-import-preview-card">
      {selectable && (
        <div className="wide-target-checkbox bibtex-import-preview-card-check">
          <span className="wide-target-checkbox-box">
            <div className="form-checkbox">
              <input
                type="checkbox"
                autoComplete="off"
                className="form-check-input"
                aria-label={row.entry ? row.entry.key : t('untitled')}
                checked={checked}
                onChange={() => onToggle(row.rowId)}
              />
            </div>
            <label className="wide-target-checkbox-target" aria-hidden="true"></label>
          </span>
        </div>
      )}
      <div className="bibtex-import-preview-card-content">
        <div className="bibtex-import-preview-card-key">
          {row.status === 'empty'
            ? t('resolving')
            : row.status === 'error' && !row.syntaxError
              ? t('could_not_import_this_reference')
              : row.entry?.key || (row.syntaxError ? row.raw.split(/\r?\n/, 1)[0] : t('untitled'))}
        </div>
        <div className="bibtex-import-preview-card-details">
          {row.heading && (
            <div className="bibtex-import-preview-card-heading">
              {row.heading}
            </div>
          )}
          {row.title && (
            <div className="bibtex-import-preview-card-field">
              {row.title}
            </div>
          )}
          {row.status === 'error' && (
            <>
              <div className="bibtex-import-preview-card-error" role="alert">
                {row.syntaxError && row.errors?.length ? (
                  <>
                    <strong>
                      {plural(t, row.errors.length, 'entry_has_syntax_error', 'entry_has_syntax_errors')}:
                    </strong>
                    <ul>
                      {row.errors.map((diagnostic, index) => (
                        <li key={index}>
                          {translateBibSourceDiagnostic(diagnostic, t)}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : row.error
                  ? t(row.error)
                  : row.raw}
              </div>
            </>
          )}
          {row.status === 'empty' && (
            <div className="bibtex-import-preview-card-resolving">
              {row.raw}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
