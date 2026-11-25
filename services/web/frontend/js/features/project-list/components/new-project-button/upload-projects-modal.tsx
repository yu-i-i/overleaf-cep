import { Dashboard } from '@uppy/react'
import { useTranslation } from 'react-i18next'
import { useBulkProjectUploader } from '../../hooks/use-bulk-project-uploader'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { useFeatureFlag } from '@/shared/context/split-test-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'

import '@uppy/core/dist/style.css'
import '@uppy/dashboard/dist/style.css'

function UploadProjectsModal({
  onHide,
  hideAndRefresh,
}: {
  onHide: () => void
  hideAndRefresh: () => void
}) {
  const { t } = useTranslation()
  const themed = useFeatureFlag('themed-modals')
  const uppyTheme = useActiveOverallTheme('themed-modals')

  const uppy = useBulkProjectUploader({
    endpoint: '/project/new/bulk_upload',
    allowedFileTypes: ['.zip'],
    onSuccess: hideAndRefresh,
  })

  return (
    <OLModal
      show
      animation
      onHide={onHide}
      id="upload-projects-modal"
      backdrop="static"
      themed={themed}
    >
      <OLModalHeader>
        <OLModalTitle as="h3">{t('upload_zipped_projects')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <Dashboard
          uppy={uppy}
          proudlyDisplayPoweredByUppy={false}
          showLinkToFileUploadResult={false}
          hideUploadButton
          showSelectedFiles={false}
          height={300}
          locale={{
            strings: {
              browseFiles: 'Select a .zip file of projects',
              dropPasteFiles: '%{browseFiles} or \n\n drag a .zip file',
            },
          }}
          className="projects-list-upload-project-modal-uppy-dashboard"
          theme={uppyTheme}
        />
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide}>
          {t('cancel')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default UploadProjectsModal
