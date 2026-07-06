import { useTranslation } from 'react-i18next'
import { FormEventHandler, useEffect, useState } from 'react'
import * as eventTracking from '@/infrastructure/event-tracking'
import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import { useFileTreeCreateForm } from '@/features/file-tree/contexts/file-tree-create-form'
import { useFileTreeCreateName } from '@/features/file-tree/contexts/file-tree-create-name'
import FileTreeCreateNameInput from '@/features/file-tree/components/file-tree-create/file-tree-create-name-input'
import ErrorMessage from '@/features/file-tree/components/file-tree-create/error-message'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLNotification from '@/shared/components/ol/ol-notification'

type ZoteroGroup = {
  id: string
  name: string
}

type FileTreeImportFromZoteroProps = { groups: ZoteroGroup[] }

export default function FileTreeImportFromZotero({ groups }: FileTreeImportFromZoteroProps) {
  const { t } = useTranslation()
  const { name, setName } = useFileTreeCreateName()
  const { setValid } = useFileTreeCreateForm()
  const { finishCreatingLinkedFile, error, inFlight } = useFileTreeActionable()
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [selectedFormat, setSelectedFormat] = useState<string>('bibtex')

  useEffect(() => {
    setValid(!!name)
  }, [name])

  const handleSubmit: FormEventHandler = event => {
    event.preventDefault()
    eventTracking.sendMB('new-file-created', {
      method: 'zotero',
      extension: name.split('.').length > 1 ? name.split('.').pop() : '',
    })

    finishCreatingLinkedFile({
      name,
      provider: 'zotero',
      data: { zoteroGroupId: selectedGroupId, bibFormat: selectedFormat }
    })
  }

  return (
    <>
    <p>{t('import_a_bibtex_file_from_your_provider_account', { provider: 'Zotero' })}</p>
    <form
      className="form-controls"
      id="create-file"
      noValidate
      onSubmit={handleSubmit}
    >
      <OLFormGroup controlId="zotero-library-select">
        <OLFormLabel>{t('library')}</OLFormLabel>
          <OLFormSelect
            id="zotero-library-select"
            value={selectedGroupId}
            disabled={inFlight}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedGroupId(e.target.value)
            }
          >
            <option value="">{t('my_library')}</option>
            {groups?.map(g => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </OLFormSelect>
      </OLFormGroup>

      <FileTreeCreateNameInput
        label={t('file_name_in_this_project')}
        placeholder="zotero.bib"
        error={error}
        inFlight={inFlight}
      />

      <OLFormGroup controlId="zotero-format-select">
        <OLFormLabel>{t('format')}</OLFormLabel>
          <OLFormSelect
            id="zotero-format-select"
            value={selectedFormat}
            disabled={inFlight}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedFormat(e.target.value)
            }
          >
            <option value="bibtex">{'BibTeX'}</option>
            <option value="biblatex">{'BibLaTeX'}</option>
          </OLFormSelect>
      </OLFormGroup>

      {inFlight && (
        <div role="status" className="loading d-flex justify-content-center align-items-center fs-5">
          <div
            aria-hidden="true"
            className="spinner-border spinner-border-sm"
          ></div>
          {t('importing') + '…'}
        </div>
      )}

      {error && <ErrorMessage error={error} />}

    </form>
    </>
  )
}
