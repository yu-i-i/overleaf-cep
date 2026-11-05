/**
 * Left-hand list controls: search and the Add menu. The actual entry rows are
 * rendered by BibEntryList, so this component stays independent of entry data.
 */
import '../../stylesheets/bib-editor-panel.css'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLDropdown,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import MaterialIcon from '@/shared/components/material-icon'

type Props = {
  readOnly?: boolean
  search: string
  onSearchChange: (search: string) => void
  openDocName: string | null
  onAddPaste: () => void
  onAddManual: () => void
  onAddFromOrcid?: () => void
}

function BibEntryListPanel({
  readOnly = false,
  search,
  onSearchChange,
  openDocName,
  onAddPaste,
  onAddManual,
  onAddFromOrcid,
}: Props) {
  const { t } = useTranslation()

  return (
    <div className="bibtex-entry-list-panel">
      <div className="bibtex-search">
        <OLFormControl
          id="bibtex-list-search"
          type="text"
          size="sm"
          value={search}
          onKeyDown={event => {
            if (event.key === 'Escape') onSearchChange('')
          }}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={t('search_bib_file', { fileName: openDocName || '.bib' })}
          aria-label={t('search')}
          prepend={<MaterialIcon type="search" />}
          append={
            search.length > 0 && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="form-control-search-clear-btn"
                aria-label={t('clear_search')}
              >
                <MaterialIcon type="clear" />
              </button>
            )
          }
        />
      </div>

      <OLDropdown className="bibtex-add-button">
        <OLDropdownToggle
          disabled={readOnly}
          variant="secondary"
          size="sm"
          className="d-inline-grid custom-toggle"
        >
          <span className="button-content" aria-hidden="false">
            <span
              className="material-symbols"
              aria-hidden="true"
              translate="no"
            >
              add
            </span>
            {t('add')}
          </span>
        </OLDropdownToggle>

        <OLDropdownMenu>
          <OLDropdownItem
            description={t('bibtex_doi_description')}
            onClick={onAddPaste}
          >
            {t('paste_references')}
          </OLDropdownItem>

          <OLDropdownItem onClick={onAddManual}>
            {t('enter_manually')}
          </OLDropdownItem>

          {onAddFromOrcid ? (
            <OLDropdownItem
              description={t('search_orcid_by_name_or_id')}
              onClick={onAddFromOrcid}
            >
              {t('import_from_orcid_org')}
            </OLDropdownItem>
          ) : null}
        </OLDropdownMenu>
      </OLDropdown>
    </div>
  )
}

export default React.memo(BibEntryListPanel)
