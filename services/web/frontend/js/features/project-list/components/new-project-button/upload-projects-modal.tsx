import { useEffect, useRef, useState } from 'react'
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
import OLBadge from '@/shared/components/ol/ol-badge'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { useFeatureFlag } from '@/shared/context/split-test-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'

import '@uppy/core/dist/style.css'
import '@uppy/dashboard/dist/style.css'

const IMPORT_STATUS_POLL_INTERVAL = 1500
const MAX_CONSECUTIVE_STATUS_ERRORS = 3
// Stop tracking the import if no progress update arrives for this long (e.g., the web server restarted during the import)
const IMPORT_STALL_TIMEOUT = 5 * 60 * 1000

type BulkUploadResult = {
  id: string
  name: string
  status: 'importing' | 'success' | 'failed'
  projectId?: string
}

type BulkUploadProgress = {
  status: 'in_progress' | 'complete' | 'failed'
  total: number
  completed: number
  failed: number
  updatedAt: string
  results: BulkUploadResult[]
  error?: string
}

type ImportPhase = 'upload' | 'importing' | 'done' | 'error'

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

  const [phase, setPhase] = useState<ImportPhase>('upload')
  const [importId, setImportId] = useState<string | null>(null)
  const [progress, setProgress] = useState<BulkUploadProgress | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const resultsListRef = useRef<HTMLUListElement>(null)

  const uppy = useBulkProjectUploader({
    endpoint: '/project/new/bulk_upload',
    allowedFileTypes: ['.zip'],
    onUploaded: newImportId => {
      setImportId(newImportId)
      setProgress(null)
      setErrorMessage(null)
      setPhase('importing')
    },
  })

  // Poll the import status while the server is processing the archive to display the import progress
  useEffect(() => {
    if (phase !== 'importing' || importId == null) {
      return
    }

    let polling = false
    let consecutiveErrors = 0

    const poll = async () => {
      if (polling || document.hidden || !navigator.onLine)
        return

      polling = true

      try {
        const { progress } = await getJSON<{
          success: boolean
          progress: BulkUploadProgress
        }>(`/project/new/bulk_upload/status?importId=${importId}`)

        consecutiveErrors = 0
        setProgress(progress)

        if (progress.status === 'complete') {
          setPhase('done')
        } else if (progress.status === 'failed') {
          setErrorMessage(progress.error ?? t('something_went_wrong'))
          setPhase('error')
        } else if (Date.now() - new Date(progress.updatedAt).getTime() > IMPORT_STALL_TIMEOUT) {
          setErrorMessage(t('cannot_check_import_status'))
          setPhase('error')
        }
      } catch {
        consecutiveErrors += 1
        if (consecutiveErrors >= MAX_CONSECUTIVE_STATUS_ERRORS) {
          setErrorMessage(t('cannot_check_import_status'))
          setPhase('error')
        }
      } finally {
        polling = false
      }
    }

    // Immediately poll once to avoid waiting for the first interval
    poll()
    // Start an interval-based poll that checks the import status every IMPORT_STATUS_POLL_INTERVAL milliseconds
    const interval = setInterval(poll, IMPORT_STATUS_POLL_INTERVAL)
    // Cleanup function that is triggered when the dependencies of the effect change (phase, importId, or t)
    return () => clearInterval(interval)
  }, [phase, importId, t])

  // Keep the results list scrolled to the bottom
  useEffect(() => {
    const resultsList = resultsListRef.current
    if (resultsList)
      resultsList.scrollTop = resultsList.scrollHeight
  }, [progress, phase])

  const handleCancel = () => {
    if (phase === 'importing' && importId != null) {
      void postJSON('/project/new/bulk_upload/cancel', {
        body: { importId },
      }).catch(() => {})
    } else if (phase === 'upload') {
      uppy.cancelAll()
    }

    hideAndRefresh()
  }

  // Handler for when the modal is closed (X-button, backdrop click, or Escape key)
  const handleClose = () => {
    if (phase === 'done') {
      hideAndRefresh()
    } else {
      handleCancel()
    }
  }

  const processedCount = progress ? progress.results.length : 0

  const resultsList =
    progress && progress.results.length > 0 ? (
      <ul
        ref={resultsListRef}
        className="upload-projects-modal-import-results"
        data-testid="upload-projects-import-results"
      >
        {progress.results.map(result => (
          <li
            key={result.id}
            className="upload-projects-modal-import-result"
          >
            <span className="upload-projects-modal-import-result-name">
              {result.name}
            </span>
            {result.status === 'importing' ? (
              <OLBadge
                bg="info"
                data-testid="upload-projects-import-result-badge"
              >
                {t('importing')}
              </OLBadge>
            ) : (
              <OLBadge
                bg={result.status === 'success' ? 'success' : 'danger'}
                data-testid="upload-projects-import-result-badge"
              >
                {result.status === 'success' ? t('imported') : t('failed')}
              </OLBadge>
            )}
          </li>
        ))}
      </ul>
    ) : null

  return (
    <OLModal
      show
      animation
      onHide={handleClose}
      id="upload-projects-modal"
      backdrop="static"
      themed={themed}
    >
      <OLModalHeader>
        <OLModalTitle as="h3">{t('upload_zipped_projects')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {phase === 'upload' && (
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
        )}
        {phase === 'importing' && (
          <div className="upload-projects-modal-import-progress">
            <div className="upload-projects-modal-import-progress-header">
              <OLSpinner size="sm" className="me-2" />
              <span>
                {progress && progress.total > 0
                  ? t('importing_projects_progress', {
                      processed: processedCount,
                      total: progress.total,
                    })
                  : t('importing_projects')}
              </span>
            </div>
            {resultsList}
          </div>
        )}
        {phase === 'done' && (
          <div className="upload-projects-modal-import-progress">
            {progress && progress.failed > 0 ? (
              <Notification
                type="warning"
                content={t('bulk_upload_partial', {
                  failed: progress.failed,
                  total: progress.total,
                })}
              />
            ) : (
              <p className="upload-projects-modal-import-complete">
                {t('bulk_upload_complete')}
              </p>
            )}
            {resultsList}
          </div>
        )}
        {phase === 'error' && (
          <Notification
            type="error"
            content={errorMessage ?? t('something_went_wrong')}
          />
        )}
      </OLModalBody>
      <OLModalFooter>
        {phase === 'done' ? (
          <OLButton variant="primary" onClick={hideAndRefresh}>
            {t('done')}
          </OLButton>
        ) : (
          <OLButton variant="secondary" onClick={handleCancel}>
            {t('cancel')}
          </OLButton>
        )}
      </OLModalFooter>
    </OLModal>
  )
}

export default UploadProjectsModal
