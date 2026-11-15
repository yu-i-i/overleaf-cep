import { useGitSync } from '../../git-sync-provider'
import { useEffect } from 'react'
import useAsync from '@/shared/hooks/use-async'
import { getJSON } from '@/infrastructure/fetch-json'
import { OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import Notification from '@/shared/components/notification'
import { debugConsole } from '@/utils/debugging'
import { ProjectSyncState, GitSyncModalStatus } from '../../types/git-sync-types'

type GitSyncMergeOverviewModalProps = {
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
  projectSyncState: ProjectSyncState
  projectId: string
  commitMessage: string
  setCommitMessage: (message: string) => void
  mergeErrorMessage: string | null
  mergeErrorKey: string | null
  clearMergeError: () => void
}

type GitCommit = {
  message: string
  author: {
    name: string
    email: string
    date: string
  }
  sha: string
}

type UnmergedCommitsResponse = {
  commits: GitCommit[]
  diverged: boolean
  isProjectUpdated: boolean
  pendingPull?: boolean
}

const GitSyncMergeOverviewModal = ({
  handleHide,
  setModalStatus,
  projectSyncState,
  projectId,
  commitMessage,
  setCommitMessage,
  mergeErrorMessage,
  mergeErrorKey,
  clearMergeError
}: GitSyncMergeOverviewModalProps) => {
  const { t, provider, basePath, repoUrl, branchUrl, commitUrl } = useGitSync()
  const appName = 'Overleaf'

  const {
    data,
    setData,
    error, setError,
    isSuccess,
    isLoading,
    runAsync,
  } = useAsync<UnmergedCommitsResponse | null>()

  const loadUnmergedCommits = () => {
    setData({})

    runAsync(getJSON(`/project/${projectId}/${basePath}/merge/overview`))
      .then(data => { if (!data) setModalStatus('loading') })
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
        if (err?.data?.message) setError(err.data.message)
        if (err?.info?.statusCode === 403 ||
            err?.info?.statusCode === 404 ||
            err?.info?.statusCode === 401
        ) setModalStatus('loading')
      })
  }

  useEffect(() => {
    loadUnmergedCommits()
  }, [projectId, runAsync])

  return (
    <>
      <OLModalBody>
        <p>
          {t('project_linked_to')}:&nbsp;
          <a
            href={projectSyncState.defaultBranchName
              ? branchUrl(projectSyncState.repoFullName, projectSyncState.defaultBranchName)
              : repoUrl(projectSyncState.repoFullName)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {projectSyncState.repoFullName}
            {projectSyncState.defaultBranchName && (
              <> ({projectSyncState.defaultBranchName})</>
            )}
          </a>
        </p>

        {mergeErrorMessage && (
          <Notification
            type={[
              'github_sync_interrupted',
              'github_sync_diverged_conflict',
              'github_sync_linked_branch_moved',
              'github_sync_merge_recovery_branch',
            ].includes(mergeErrorKey ?? '')
              ? 'warning'
              : 'error'
            }
            content={mergeErrorMessage}
          />
        )}

        {(!mergeErrorMessage && data?.pendingPull) && (
          <Notification type="warning" content={t('github_sync_import_pending')} />
        )}

        {isLoading && (
          <>
            <div role="status" className="loading align-items-start">
              <div
                aria-hidden="true"
                data-testid="ol-spinner"
                className="spinner-border spinner-border-sm"
              ></div>
              {t('loading')}
            </div>
          </>
        )}

        {isSuccess && (
          <>
            <hr />

            {data.diverged && (
              <Notification
                type="warning"
                content={t('github_repository_diverged')}
              />
            )}

            <h3 className="git-sync-commits-heading">
              {t('recent_commits_in_github')}

              <OLIconButton
                icon="refresh"
                size="sm"
                variant="ghost"
                onClick={loadUnmergedCommits}
                accessibilityLabel={t('refresh')}
              />
            </h3>

            {data.commits?.length === 0 && (
              <div>
                <p className="small">{t('no_new_commits_in_github')}</p>
              </div>
            )}

            {data.commits?.length > 0 && (
              <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                {data.commits.map((commit: GitCommit) => (
                  <div key={commit.sha}>
                    <span className="small float-end">
                      <a
                        href={commitUrl(projectSyncState.repoFullName, commit.sha)}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {commit.sha.substring(0, 7)}
                      </a>
                    </span>

                    <a
                      href={commitUrl(projectSyncState.repoFullName, commit.sha)}
                      target="_blank"
                      className="commit-message"
                      rel="noreferrer noopener"
                    >
                      {commit.message}
                    </a>

                    <div className="small">
                      by {commit.author.name} &lt;{commit.author.email}&gt;
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.isProjectUpdated && !data.pendingPull && (
              <>
                <hr />
                <OLForm>
                  <p>{t('sync_project_to_github_explanation', { appName })}</p>
                  <OLRow>
                    <OLCol xs={12}>
                      <OLFormGroup>
                        <OLFormControl
                          as="textarea"
                          rows={1}
                          value={commitMessage}
                          placeholder={t('github_commit_message_placeholder', { appName })}
                          onChange={(e) => setCommitMessage(e.target.value)}
                        />
                      </OLFormGroup>
                    </OLCol>
                  </OLRow>
                </OLForm>
              </>
            )}
          </>
        )}

        {error && (
          <Notification
            type="error"
            content={error}
          />
        )}

      </OLModalBody>

      <OLModalFooter>
        <div className="d-flex justify-content-between w-100">

          <div className="d-flex gap-2">
            <OLButton
              variant="danger-ghost"
              onClick={() => setModalStatus('confirm-unlink')}
              disabled={!isSuccess && error?.info?.statusCode !== 404}
            >
              {t('unlink')}
            </OLButton>
          </div>

          <div className="d-flex gap-2">
            <OLButton
              variant="primary"
              leadingIcon="sync"
              onClick={() => {
                clearMergeError()
                setModalStatus('run-merge')
              }}
              disabled={!isSuccess}
            >
              {t('sync')}
            </OLButton>

            <OLButton
              variant="secondary"
              onClick={handleHide}
            >
              {t('close')}
            </OLButton>
          </div>

        </div>
      </OLModalFooter>
    </>
  )
}

export default GitSyncMergeOverviewModal
