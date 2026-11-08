import { useGitSync } from '../../git-sync-provider'
import { useEffect, useState } from 'react'
import { Trans } from 'react-i18next'
import { debugConsole } from '@/utils/debugging'
import { postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { GitSyncModalStatus, ProjectSyncState } from '../../types/git-sync-types'

import { useReferencesContext } from '@/features/ide-react/context/references-context'

type ResolutionConfirmation = {
  branch: string
  head: string
  linkedBranch: string
  sourceBranch: string
  sourceCommit: string
  conflictVersion: number
  lastSyncCommit: string
  unchanged: boolean
  recoveryFromVersion: number | null
  recoveryVersion: number | null
}

type ResolutionState =
  | { phase: 'running' }
  | { phase: 'confirm' | 'accepted', resolution: ResolutionConfirmation }

type GitSyncMergeModalProps = {
  handleHide: () => void
  modalStatus: GitSyncModalStatus
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
  setProjectSyncState: (projectSyncState: ProjectSyncState) => void
  setMergeErrorMessage: (message: string, key?: string) => void
  commitMessage: string
  setCommitMessage: (message: string) => void
  projectId: string
  repoFullName: string
}

const GitSyncMergeModal = ({
  handleHide,
  modalStatus,
  setModalStatus,
  setProjectSyncState,
  setMergeErrorMessage,
  commitMessage,
  setCommitMessage,
  projectId,
  repoFullName
}: GitSyncMergeModalProps) => {

  const { t, basePath, commitUrl } = useGitSync()
  const { isLoading, runAsync } = useAsync<ProjectSyncState>()
  const [resolutionState, setResolutionState] = useState<ResolutionState>({ phase: 'running' })
  const requestedResolution = resolutionState.phase === 'confirm' ? resolutionState.resolution : null
  const { indexAllReferences } = useReferencesContext()

  useEffect(() => {
    if (modalStatus !== 'run-merge' &&
        modalStatus !== 'run-merge-resolved'
    ) return

    if (resolutionState.phase === 'confirm') return

    const claimConflictIsResolved = (modalStatus === 'run-merge-resolved')

    runAsync(
      postJSON(`/project/${projectId}/${basePath}/merge`, {
        body: { message: commitMessage, claimConflictIsResolved, resolutionConfirmation: resolutionState.phase === 'accepted' ? resolutionState.resolution : null },
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
            throw new Error(message)
        }
        setProjectSyncState(data)
        setCommitMessage('')
      })
      .catch(err => {
        if (err?.data?.key === 'resolution_confirmation_required' && err.data.resolution) {
          setResolutionState({ phase: 'confirm', resolution: err.data.resolution })
          return
        }
        debugConsole.error(err?.data?.message || err?.message || err)
        if (err?.info?.statusCode === 403 || err?.info?.statusCode === 404) {
          setModalStatus('loading')
        } else {
          setMergeErrorMessage(
            err?.data?.key
              ? t(err.data.key, err.data.translationOptions)
              : err?.data?.message || t('something_went_wrong_server'),
            err?.data?.key
          )
          setModalStatus(claimConflictIsResolved ? 'show-conflict' : 'merge-overview')
        }
      })

  }, [
    modalStatus,
    projectId,
    commitMessage,
    runAsync,
    resolutionState,
  ])

  if (requestedResolution) {
    return (
      <>
        <OLModalBody>
          {requestedResolution.recoveryVersion != null ? (
            <div className="mt-2">
              <Notification
                type="warning"
                content={
                  <p>
                    <Trans
                      i18nKey="github_sync_recovery_review_history"
                      values={{ branch: requestedResolution.branch }}
                      components={[<b />]}
                    />
                  </p>
                }
              />
            </div>
          ) : (
            <>
              <Notification
                type="warning"
                content={
                  <>
                    {requestedResolution.unchanged ? (
                      <p>
                        <Trans
                          i18nKey="github_sync_resolution_unchanged"
                          values={{ branch: requestedResolution.branch }}
                          components={[<b />]}
                        />
                      </p>
                    ) : (
                      <p>
                        <Trans
                          i18nKey="github_sync_resolution_unverified"
                          values={{ branch: requestedResolution.branch }}
                          components={[<b />]}
                        />
                      </p>
                    )}
                  </>
                }
              />
              <p className="mt-2">
                <Trans
                  i18nKey="github_sync_resolution_effect"
                  values={{ branch: requestedResolution.branch }}
                  components={[<b />]}
                />
              </p>
            </>
	  )}
          <Trans
            i18nKey="github_sync_resolution_reviewed_commit"
            values={{
              branch: requestedResolution.branch,
              head: requestedResolution.head.slice(0, 7)
            }}
            components={[
              <b />,
              <a
                href={commitUrl(repoFullName, requestedResolution.head)}
                target="_blank"
                rel="noreferrer noopener"
              />
            ]}
          />
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={() => setModalStatus(requestedResolution.recoveryVersion == null ? 'show-conflict' : 'loading')}>
            {t('cancel')}
          </OLButton>
          <OLButton variant="primary" onClick={() => {
            setResolutionState({ phase: 'accepted', resolution: requestedResolution })
          }}>
            {t('continue')}
          </OLButton>
        </OLModalFooter>
      </>
    )
  }

  if (!isLoading) return null

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
