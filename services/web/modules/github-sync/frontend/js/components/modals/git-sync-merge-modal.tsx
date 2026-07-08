import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { debugConsole } from '@/utils/debugging'
import { postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import clientId from '@/utils/client-id'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import { GitSyncModalStatus, ProjectSyncState } from '../../types/git-sync-types'

import { useReferencesContext } from '@/features/ide-react/context/references-context'

type GitSyncMergeModalProps = {
  handleHide: () => void
  modalStatus: GitSyncModalStatus
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
  setProjectSyncState: (projectSyncState: ProjectSyncState) => void
  commitMessage: string
  setCommitMessage: (message: string) => void
  projectId: string
}

const GitSyncMergeModal = ({
  handleHide,
  modalStatus,
  setModalStatus,
  setProjectSyncState,
  commitMessage,
  setCommitMessage,
  projectId
}: GitSyncMergeModalProps) => {

  const { t } = useTranslation()
  const { error, isError, isLoading, setError, runAsync } = useAsync<ProjectSyncState>()
  const { indexAllReferences } = useReferencesContext()

  useEffect(() => {
    if (modalStatus !== 'run-merge' &&
        modalStatus !== 'run-merge-resolved'
    ) return

    const claimConflictIsResolved = (modalStatus === 'run-merge-resolved')

    runAsync(
      postJSON(`/project/${projectId}/github-sync/merge`, {
        body: { message: commitMessage, claimConflictIsResolved },
      })
    )
      .then(async data => {
        switch (data.mergeStatus) {

          case 'clean':
            setModalStatus('merge-overview')

            await postJSON(`/project/${projectId}/flush`)
              .catch(e => debugConsole.error(e))

            indexAllReferences(true)

            break

          case 'conflict':
            setModalStatus('show-conflict')
            break

          default:
            const message = `Unexpected merge status received: ${data.mergeStatus}`
            const msError = new Error(message)
            setError(msError)
            throw msError
        }
        setProjectSyncState(data)
        setCommitMessage('')
      })
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
        if (err?.info?.statusCode === 403 || err?.info?.statusCode === 404) setModalStatus('loading')
      })

  }, [
    modalStatus,
    projectId,
    commitMessage,
    runAsync,
  ])

  if (!isLoading && !isError) return

  return (
    <>
      <OLModalBody>
        <div
          role="status"
          className="loading align-items-start"
        >
          <div
            aria-hidden="true"
            data-testid="ol-spinner"
            className="spinner-border spinner-border-sm"
          ></div>

          {t('importing_and_merging_changes_in_github')}
        </div>
      </OLModalBody>

      {error && (
        <OLNotification
          type="error"
          content={t('generic_something_went_wrong')}
        />
      )}

      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncMergeModal
