import { useState, useCallback } from 'react'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLNotification from '@/shared/components/notification'
import { getJSON } from '@/infrastructure/fetch-json'

type AuthorResult = {
  orcid: string
  givenNames: string
  familyNames: string
  institutionNames: string[]
}

type Work = {
  title: string
  year: string
  type: string
  doi: string | null
  putCode: number
}

type OrcidPickerModalProps = {
  show: boolean
  handleHide: () => void
  onInsert: (bibtex: string) => void
}

type Step = 'search' | 'works'

export default function OrcidPickerModal({
  show,
  handleHide,
  onInsert,
}: OrcidPickerModalProps) {
  // -- step state --
  const [step, setStep] = useState<Step>('search')

  // -- search step --
  const [searchMode, setSearchMode] = useState<'name' | 'orcid'>('name')
  const [nameQuery, setNameQuery] = useState('')
  const [orcidInput, setOrcidInput] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [authors, setAuthors] = useState<AuthorResult[]>([])

  // -- works step --
  const [selectedOrcid, setSelectedOrcid] = useState<string | null>(null)
  const [selectedAuthorName, setSelectedAuthorName] = useState('')
  const [works, setWorks] = useState<Work[]>([])
  const [worksLoading, setWorksLoading] = useState(false)
  const [worksError, setWorksError] = useState<string | null>(null)
  const [selectedPutCodes, setSelectedPutCodes] = useState<Set<number>>(new Set())

  // -- import state --
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // -----------------------------------------------------------------------
  // Reset everything when the modal closes
  // -----------------------------------------------------------------------
  const handleClose = useCallback(() => {
    setStep('search')
    setSearchMode('name')
    setNameQuery('')
    setOrcidInput('')
    setSearchLoading(false)
    setSearchError(null)
    setAuthors([])
    setSelectedOrcid(null)
    setSelectedAuthorName('')
    setWorks([])
    setWorksLoading(false)
    setWorksError(null)
    setSelectedPutCodes(new Set())
    setImporting(false)
    setImportError(null)
    handleHide()
  }, [handleHide])

  // -----------------------------------------------------------------------
  // Search by name
  // -----------------------------------------------------------------------
  const handleSearchByName = useCallback(async () => {
    if (!nameQuery.trim()) return
    setSearchError(null)
    setAuthors([])
    setSearchLoading(true)
    try {
      const data = await getJSON<{ results: AuthorResult[] }>(
        `/orcid-picker/search?q=${encodeURIComponent(nameQuery.trim())}`
      )
      setAuthors(data.results)
      if (data.results.length === 0) {
        setSearchError('No authors found')
      }
    } catch (err: any) {
      setSearchError(
        err?.data?.error || err?.message || 'Search failed'
      )
    } finally {
      setSearchLoading(false)
    }
  }, [nameQuery])

  // -----------------------------------------------------------------------
  // Pick an author (go to works step)
  // -----------------------------------------------------------------------
  const handlePickAuthor = useCallback(
    async (orcid: string, displayName: string) => {
      setSelectedOrcid(orcid)
      setSelectedAuthorName(displayName)
      setStep('works')
      setWorksError(null)
      setWorks([])
      setSelectedPutCodes(new Set())
      setWorksLoading(true)
      try {
        const data = await getJSON<{ works: Work[] }>(
          `/orcid-picker/works?orcid=${encodeURIComponent(orcid)}`
        )
        setWorks(data.works)
        if (data.works.length === 0) {
          setWorksError('No works found for this author')
        }
      } catch (err: any) {
        setWorksError(
          err?.data?.error || err?.message || 'Failed to load works'
        )
      } finally {
        setWorksLoading(false)
      }
    },
    []
  )

  // -----------------------------------------------------------------------
  // Direct ORCID input
  // -----------------------------------------------------------------------
  const handleGoToWorksByOrcid = useCallback(async () => {
    const orcid = orcidInput.trim()
    if (!orcid) return
    await handlePickAuthor(orcid, orcid)
  }, [orcidInput, handlePickAuthor])

  // -----------------------------------------------------------------------
  // Toggle a work selection (by put-code)
  // -----------------------------------------------------------------------
  const toggleWork = useCallback((putCode: number) => {
    setSelectedPutCodes(prev => {
      const next = new Set(prev)
      if (next.has(putCode)) {
        next.delete(putCode)
      } else {
        next.add(putCode)
      }
      return next
    })
  }, [])

  // Select / deselect all works
  const allSelected =
    works.length > 0 &&
    works.every(w => selectedPutCodes.has(w.putCode))

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedPutCodes(new Set())
    } else {
      setSelectedPutCodes(new Set(works.map(w => w.putCode)))
    }
  }, [allSelected, works])

  // -----------------------------------------------------------------------
  // Import selected works
  // -----------------------------------------------------------------------
  const handleImport = useCallback(async () => {
    if (selectedPutCodes.size === 0 || !selectedOrcid) return
    setImporting(true)
    setImportError(null)

    const bibtexEntries: string[] = []
    const errors: string[] = []

    for (const putCode of selectedPutCodes) {
      const work = works.find(w => w.putCode === putCode)
      const label = work?.title || `put-code ${putCode}`
      try {
        const data = await getJSON<{ bibtex: string }>(
          `/orcid-picker/fetch-bib?orcid=${encodeURIComponent(selectedOrcid)}&putCode=${encodeURIComponent(String(putCode))}`
        )
        bibtexEntries.push(data.bibtex)
      } catch (err: any) {
        errors.push(
          `${label}: ${err?.data?.error || err?.message || 'failed'}`
        )
      }
    }

    setImporting(false)

    if (bibtexEntries.length > 0) {
      onInsert(bibtexEntries.join('\n\n'))
    }

    if (errors.length > 0) {
      setImportError(
        `Failed to fetch ${errors.length} work(s):\n${errors.join('\n')}`
      )
    } else {
      handleClose()
    }
  }, [selectedPutCodes, selectedOrcid, works, onInsert, handleClose])

  // -----------------------------------------------------------------------
  // Key handlers
  // -----------------------------------------------------------------------
  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSearchByName()
      }
    },
    [handleSearchByName]
  )

  const handleOrcidKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleGoToWorksByOrcid()
      }
    },
    [handleGoToWorksByOrcid]
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <OLModal show={show} onHide={handleClose}>
      <OLModalHeader closeButton>
        <OLModalTitle>
          {step === 'search'
            ? 'Import from ORCID'
            : `Works — ${selectedAuthorName}`}
        </OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {/* ============================================================ */}
        {/* STEP 1: Find the author                                      */}
        {/* ============================================================ */}
        {step === 'search' && (
          <>
            {/* Toggle between search-by-name and direct ORCID */}
            <div style={{ marginBottom: '12px' }}>
              <OLButton
                variant={searchMode === 'name' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSearchMode('name')}
                style={{ marginRight: '8px' }}
              >
                Search by name
              </OLButton>
              <OLButton
                variant={searchMode === 'orcid' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSearchMode('orcid')}
              >
                Enter ORCID
              </OLButton>
            </div>

            {searchMode === 'name' && (
              <>
                <OLFormGroup>
                  <OLFormLabel htmlFor="orcid-name-input">
                    Author name
                  </OLFormLabel>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <OLFormControl
                      id="orcid-name-input"
                      type="text"
                      placeholder="e.g. Jane Smith"
                      value={nameQuery}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setNameQuery(e.target.value)
                      }
                      onKeyDown={handleNameKeyDown}
                      disabled={searchLoading}
                      autoFocus
                    />
                    <OLButton
                      variant="primary"
                      onClick={handleSearchByName}
                      disabled={searchLoading || !nameQuery.trim()}
                      isLoading={searchLoading}
                    >
                      Search
                    </OLButton>
                  </div>
                </OLFormGroup>

                {searchError && (
                  <OLNotification
                    type="error"
                    content={searchError}
                    isDismissible
                  />
                )}

                {authors.length > 0 && (
                  <div
                    style={{
                      maxHeight: '300px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                    }}
                  >
                    <table
                      style={{ width: '100%', borderCollapse: 'collapse' }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-light-secondary)',
                          }}
                        >
                          <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                            Name
                          </th>
                          <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                            ORCID
                          </th>
                          <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                            Affiliation
                          </th>
                          <th style={{ padding: '6px 10px' }} />
                        </tr>
                      </thead>
                      <tbody>
                        {authors.map(a => {
                          const display = [a.givenNames, a.familyNames]
                            .filter(Boolean)
                            .join(' ')
                          return (
                            <tr
                              key={a.orcid}
                              style={{
                                borderBottom: '1px solid var(--border-color)',
                                cursor: 'pointer',
                              }}
                              onClick={() =>
                                handlePickAuthor(a.orcid, display || a.orcid)
                              }
                            >
                              <td style={{ padding: '6px 10px' }}>
                                {display || '(no name)'}
                              </td>
                              <td
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '12px',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {a.orcid}
                              </td>
                              <td
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '12px',
                                }}
                              >
                                {a.institutionNames?.join(', ') || '—'}
                              </td>
                              <td style={{ padding: '6px 10px' }}>
                                <OLButton variant="link" size="sm">
                                  Select
                                </OLButton>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {searchMode === 'orcid' && (
              <OLFormGroup>
                <OLFormLabel htmlFor="orcid-id-input">ORCID iD</OLFormLabel>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <OLFormControl
                    id="orcid-id-input"
                    type="text"
                    placeholder="e.g. 0000-0002-1825-0097"
                    value={orcidInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setOrcidInput(e.target.value)
                    }
                    onKeyDown={handleOrcidKeyDown}
                    disabled={worksLoading}
                    autoFocus
                  />
                  <OLButton
                    variant="primary"
                    onClick={handleGoToWorksByOrcid}
                    disabled={worksLoading || !orcidInput.trim()}
                    isLoading={worksLoading}
                  >
                    Load works
                  </OLButton>
                </div>
              </OLFormGroup>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* STEP 2: Select publications                                  */}
        {/* ============================================================ */}
        {step === 'works' && (
          <>
            <OLButton
              variant="link"
              size="sm"
              onClick={() => setStep('search')}
              style={{ padding: 0, marginBottom: '8px' }}
            >
              ← Back to search
            </OLButton>

            {worksLoading && <p>Loading works…</p>}

            {worksError && (
              <OLNotification
                type="error"
                content={worksError}
                isDismissible
              />
            )}

            {importError && (
              <OLNotification
                type="warning"
                content={importError}
                isDismissible
              />
            )}

            {works.length > 0 && (
              <>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      style={{ marginRight: '6px' }}
                    />
                    Select all ({works.length})
                  </label>
                </div>
                <div
                  style={{
                    maxHeight: '350px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                  }}
                >
                  <table
                    style={{ width: '100%', borderCollapse: 'collapse' }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-light-secondary)',
                        }}
                      >
                        <th style={{ padding: '6px 10px', width: '30px' }} />
                        <th
                          style={{ padding: '6px 10px', textAlign: 'left' }}
                        >
                          Title
                        </th>
                        <th
                          style={{
                            padding: '6px 10px',
                            textAlign: 'left',
                            width: '60px',
                          }}
                        >
                          Year
                        </th>
                        <th
                          style={{ padding: '6px 10px', textAlign: 'left' }}
                        >
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {works.map((w, i) => (
                          <tr
                            key={w.putCode ?? i}
                            style={{
                              borderBottom: '1px solid var(--border-color)',
                            }}
                          >
                            <td style={{ padding: '6px 10px' }}>
                              <input
                                type="checkbox"
                                checked={selectedPutCodes.has(w.putCode)}
                                onChange={() => toggleWork(w.putCode)}
                              />
                            </td>
                            <td style={{ padding: '6px 10px' }}>
                              {w.title || '(untitled)'}
                            </td>
                            <td
                              style={{
                                padding: '6px 10px',
                                fontSize: '12px',
                              }}
                            >
                              {w.year || '—'}
                            </td>
                            <td
                              style={{
                                padding: '6px 10px',
                                fontSize: '12px',
                              }}
                            >
                              {w.type || '—'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </OLModalBody>

      {step === 'works' && works.length > 0 && (
        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleClose}>
            Cancel
          </OLButton>
          <OLButton
            variant="primary"
            onClick={handleImport}
            disabled={selectedPutCodes.size === 0 || importing}
            isLoading={importing}
          >
            {importing
              ? 'Importing…'
              : `Import ${selectedPutCodes.size} selected`}
          </OLButton>
        </OLModalFooter>
      )}
    </OLModal>
  )
}
