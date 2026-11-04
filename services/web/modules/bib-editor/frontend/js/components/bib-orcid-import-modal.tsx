/** ORCID search and import interface for the BibTeX editor. */
import { useId } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { OLModal, OLModalHeader, OLModalTitle, OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import Notification from '@/shared/components/notification'
import { useOrcidPicker } from '../orcid/hooks/use-orcid-picker'
import { isValidOrcid } from '../orcid/orcid-api'
import { useBibOrcidImport } from '../orcid/hooks/use-bib-orcid-import'
import { plural } from '../utils/plural'
import '../../stylesheets/bib-orcid-import.css'

type Props = { show: boolean; onHide: () => void }

export default function BibOrcidImportModal({ show, onHide }: Props) {
  const { t } = useTranslation()
  const searchModeId = useId()
  const orcidModeId = useId()
  const selectAllId = useId()
  const bridge = useBibOrcidImport(show)
  const {
    step, searchMode, nameQuery, orcidInput, searchLoading, searchError, authors,
    selectedAuthorName, works, worksLoading, worksError, selectedPutCodes,
    importing, importError, importSummary, crossrefFailures, unimportedTitles, allSelected,
    setOrcidInput, setSearchError, setWorksError, setImportError,
    handleClose, goBack, handleSearchModeChange, changeNameQuery,
    handleSearchByName, handleGoToWorksByOrcid, handlePickAuthor,
    toggleWork, toggleAll, handleImport,
  } = useOrcidPicker({ show, onHide, ...bridge, t })
  const isReport = step === 'works' && importSummary !== null

  // Presentation-only handlers
  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    void handleSearchByName()
  }

  const handleOrcidKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    void handleGoToWorksByOrcid()
  }

  const importWarning = importError && (
    <Notification
      type="warning"
      content={importError}
      isDismissible
      onDismiss={() => setImportError(null)}
    />
  )

  return (
    <OLModal
      data-bib-editor-dialog
      show={show}
      onHide={handleClose}
      data-testid="orcid-picker-modal"
      scrollable
      themed
    >
      <OLModalHeader closeButton>
        {step === 'works' && !isReport ? (
          <>
            <OLButton
              variant="ghost"
              className="ps-1"
              leadingIcon="arrow_back"
              disabled={importing}
              onClick={goBack}
              data-testid="orcid-back"
            >
              {t('back')}
            </OLButton>
            <OLModalTitle className="visually-hidden">{t('import_from_orcid_org')}</OLModalTitle>
          </>
        ) : (
          <OLModalTitle>{t('import_from_orcid_org')}</OLModalTitle>
        )}
      </OLModalHeader>

      <OLModalBody className={step === 'works' && !isReport ? 'orcid-picker-works-body' : undefined}>
        {step === 'search' && (
          <>
            {/* Reuse the upstream Code/Visual editor toggle styling. */}
            <div
              className="editor-toggle-switch mb-3"
              data-testid="orcid-mode-toggle"
            >
              <fieldset className="toggle-switch">
                <legend className="visually-hidden">
                  {t('search_orcid_by_name_or_id')}
                </legend>
                <input
                  type="radio"
                  name={searchModeId}
                  id={searchModeId}
                  className="toggle-switch-input"
                  value="name"
                  checked={searchMode === 'name'}
                  onChange={() => handleSearchModeChange('name')}
                />
                <label htmlFor={searchModeId} className="toggle-switch-label">
                  <span>{t('search_by_name')}</span>
                </label>
                <span>
                  <input
                    type="radio"
                    name={searchModeId}
                    id={orcidModeId}
                    className="toggle-switch-input"
                    value="orcid"
                    checked={searchMode === 'orcid'}
                    onChange={() => handleSearchModeChange('orcid')}
                  />
                  <label htmlFor={orcidModeId} className="toggle-switch-label">
                    <span>{t('enter_orcid_id')}</span>
                  </label>
                </span>
              </fieldset>
            </div>

            {searchError && (
              <Notification
                type="error"
                content={searchError}
                isDismissible
                onDismiss={() => setSearchError(null)}
              />
            )}

            {searchMode === 'name' && (
              <>
                <OLFormGroup>
                  <OLFormLabel htmlFor="orcid-name-input">
                    {t('author_name')}
                  </OLFormLabel>
                  <div className="d-flex gap-2">
                    <OLFormControl
                      id="orcid-name-input"
                      className="flex-grow-1"
                      type="text"
                      placeholder="Jane Doe"
                      value={nameQuery}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        changeNameQuery(e.target.value)
                      }}
                      onKeyDown={handleNameKeyDown}
                      disabled={searchLoading}
                    />
                    <OLButton
                      variant="primary"
                      className="flex-shrink-0"
                      onClick={() => void handleSearchByName()}
                      disabled={searchLoading || !nameQuery.trim()}
                      isLoading={searchLoading}
                    >
                      {t('search')}
                    </OLButton>
                  </div>
                </OLFormGroup>

                {authors.length > 0 && (
                  <div
                    className="orcid-picker-authors bibtex-import-preview-list"
                    data-testid="orcid-authors"
                  >
                    {authors.map(a => {
                      const display = [a.givenNames, a.familyNames]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <button
                          key={a.orcid}
                          type="button"
                          className="bibtex-import-preview-card orcid-picker-author-card"
                          onClick={() => void handlePickAuthor(a.orcid, display || a.orcid)}
                        >
                          <span className="bibtex-import-preview-card-content">
                            <span className="bibtex-import-preview-card-heading">
                              {display || t('no_name')}
                            </span>
                            <span className="bibtex-import-preview-card-details">
                              <span className="font-monospace small">{a.orcid}</span>
                              <span className="bibtex-import-preview-card-field">
                                {a.institutionNames.join(', ') || '—'}
                              </span>
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {searchMode === 'orcid' && (
              <OLFormGroup>
                <OLFormLabel htmlFor="orcid-id-input">{t('orcid_id')}</OLFormLabel>
                <div className="d-flex gap-2">
                  <OLFormControl
                    id="orcid-id-input"
                    className="flex-grow-1"
                    type="text"
                    placeholder="0000-0000-0000-0000"
                    value={orcidInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setOrcidInput(e.target.value)
                    }
                    onKeyDown={handleOrcidKeyDown}
                    disabled={worksLoading}
                  />
                  <OLButton
                    variant="primary"
                    className="flex-shrink-0"
                    onClick={() => void handleGoToWorksByOrcid()}
                    disabled={worksLoading || !isValidOrcid(orcidInput.trim())}
                    isLoading={worksLoading}
                  >
                    {t('load_works')}
                  </OLButton>
                </div>
              </OLFormGroup>
            )}
          </>
        )}

        {step === 'works' && !isReport && (
          <>
            <div className="orcid-picker-works-summary">
              <div className="d-flex align-items-center gap-2">
                <h3 className="h5 mb-0">{t('works_by_author', { author: selectedAuthorName })}</h3>
                {worksLoading && <span className="spinner-border spinner-border-sm" role="status" aria-label={t('loading')} />}
              </div>
              {works.length > 0 && (
                <div className="small text-muted">
                  {`${works.length} ${plural(t, works.length, 'reference', 'references')}`}
                </div>
              )}
            </div>
            {importWarning}
            {unimportedTitles.length > 0 && (
              <ul className="orcid-picker-enrichment-titles">
                {unimportedTitles.map((title, index) => <li key={index}>{title}</li>)}
              </ul>
            )}

            <div className="orcid-picker-works-scroll">
              {worksError && (
                <Notification
                  type="error"
                  content={worksError}
                  isDismissible
                  onDismiss={() => setWorksError(null)}
                />
              )}

              {works.length > 0 && (
                <div className="bibtex-import-preview-header orcid-picker-select-all-row">
                  <div className="wide-target-checkbox bibtex-import-preview-check-all">
                    <span className="wide-target-checkbox-box">
                      <div className="form-checkbox">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          aria-label={t('select_all')}
                          id={selectAllId}
                          checked={allSelected}
                          disabled={importing || worksLoading}
                          onChange={toggleAll}
                        />
                      </div>
                      <label className="wide-target-checkbox-target" htmlFor={selectAllId} aria-hidden="true" />
                    </span>
                  </div>
                  <label className="bibtex-import-preview-count" htmlFor={selectAllId}>
                    {t('select_all')}
                  </label>
                </div>
              )}
              {works.length > 0 && (
                <div className="orcid-picker-works bibtex-import-preview-list" data-testid="orcid-works">
                  {works.map(w => (
                    <div className="bibtex-import-preview-card" key={w.putCode}>
                      <div className="wide-target-checkbox bibtex-import-preview-card-check">
                        <span className="wide-target-checkbox-box">
                          <div className="form-checkbox">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              autoComplete="off"
                              checked={selectedPutCodes.has(w.putCode)}
                              disabled={importing}
                              onChange={() => toggleWork(w.putCode)}
                              aria-label={w.title || t('untitled')}
                            />
                          </div>
                          <label className="wide-target-checkbox-target" aria-hidden="true" />
                        </span>
                      </div>
                      <div className="bibtex-import-preview-card-content">
                        <div className="bibtex-import-preview-card-heading">
                          {w.title || t('untitled')}
                        </div>
                        {w.year && <div className="bibtex-import-preview-card-field">{w.year}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {isReport && importSummary && (
          <>
            <div className="orcid-picker-import-summary" role="status" data-testid="orcid-import-summary">
              <div>
                {plural(t, importSummary.imported, 'orcid_imported_reference', 'orcid_imported_references')}
              </div>
              {importSummary.enriched > 0 && (
                <div>{plural(t, importSummary.enriched, 'orcid_enriched_reference', 'orcid_enriched_references')}</div>
              )}
              {crossrefFailures.length > 0 && (
                <div className="orcid-picker-enrichment-warning" role="alert">
                  <div className="orcid-picker-enrichment-danger">
                    {plural(t, crossrefFailures.length, 'orcid_enrichment_failed_reference', 'orcid_enrichment_failed_references')}
                  </div>
                  <ul className="orcid-picker-enrichment-titles">
                    {crossrefFailures.map((failure, index) => (
                      <li key={index}>{failure.title}</li>
                    ))}
                  </ul>
                  {crossrefFailures.some(failure => failure.reason === 'rate-limit') && (
                    <div className="orcid-picker-enrichment-danger">{t('orcid_crossref_rate_limited')}</div>
                  )}
                </div>
              )}
            </div>
            {importWarning}
            {unimportedTitles.length > 0 && (
              <ul className="orcid-picker-enrichment-titles">
                {unimportedTitles.map((title, index) => <li key={index}>{title}</li>)}
              </ul>
            )}
          </>
        )}
      </OLModalBody>

      {step === 'works' && (works.length > 0 || isReport) && (
        <OLModalFooter>
          <div className="bibtex-import-preview-footer-actions">
            {!isReport && (
              <div className="bibtex-import-preview-footer-count">
                {`${selectedPutCodes.size} ${plural(t, selectedPutCodes.size, 'reference', 'references')}`}
              </div>
            )}
            <div className="bibtex-import-preview-footer-buttons orcid-picker-footer-buttons">
              <OLButton
                variant="secondary"
                onClick={handleClose}
                disabled={importing}
              >
                {t(isReport ? 'close' : 'cancel')}
              </OLButton>
              {!isReport && (
                <OLButton
                  variant="primary"
                  className="orcid-picker-import-button"
                  onClick={() => void handleImport()}
                  disabled={selectedPutCodes.size === 0 || importing}
                >
                  <span className="orcid-picker-import-content">
                    <span className={importing ? 'invisible' : undefined} aria-hidden={importing}>
                      {t('import')}
                    </span>
                    {importing && (
                      <span className="spinner-border spinner-border-sm orcid-picker-import-spinner"
                        role="status" aria-label={t('importing')} />
                    )}
                  </span>
                </OLButton>
              )}
            </div>
          </div>
        </OLModalFooter>
      )}
    </OLModal>
  )
}
