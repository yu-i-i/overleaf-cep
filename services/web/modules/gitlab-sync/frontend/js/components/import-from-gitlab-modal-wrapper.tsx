import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import {
  postJSON,
  getJSON,
} from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import OLNotification from '@/shared/components/ol/ol-notification'

type GitSyncRepo = {
  name: string
  fullName: string
  defaultBranchName: string
}

type GitSyncReposResponse = {
  repos?: GitSyncRepo[]
}

function ImportFromGitLabModalContent({ handleHide }: { handleHide: () => void }) {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  const {
    isLoading,
    isSuccess,
    isError,
    data,
    runAsync,
  } = useAsync<GitSyncReposResponse>()

  useEffect(() => {
    runAsync(getJSON('/user/gitlab-sync/repos'))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [runAsync])

  const reposExist = data?.repos != null
  const repos = reposExist ? data.repos : []

  const {
    isLoading: isImporting,
    isSuccess: isImported,
    isError: isErrorImport,
    runAsync: runAsyncImport,
  } = useAsync<{ projectId: string }>()

  useEffect(() => {
    if (isImported) {
      handleHide()
    }
  }, [handleHide, isImported])

  let gitlabUrl = getMeta('ol-ExposedSettings').gitlabUrl || ''
  gitlabUrl = gitlabUrl.endsWith('/') ? gitlabUrl.slice(0, -1) : gitlabUrl

  const showLinkToGitLab = !isImporting && isSuccess && !reposExist
  const showRepos = !isImporting && isSuccess && reposExist

  const handleImport = (repo: GitSyncRepo) => {

    runAsyncImport(
      postJSON('/project/new/gitlab-sync', {
        body: repo
      })
    )
      .then(data => {
        window.location.href = `/project/${data.projectId}`
      })
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }

  return (
    <>
      <OLModalHeader onClose={handleHide}>
        <OLModalTitle>{t('import_from_gitlab')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {isLoading && (
          <span>
            <OLSpinner size="sm" className="me-2"/>
            {t('loading_gitlab_repositories')}
          </span>
        )}

        {isImporting && (
          <span>
            <OLSpinner size="sm" className="me-2"/>
            {t('importing')}
          </span>
        )}

        {isError && (
          <div className="notification-list">
            <OLNotification
              type="error"
              content={t('something_went_wrong_server')}
            />
          </div>
        )}

        {showLinkToGitLab && (
          <div className="text-center">
            <p>
              {t('link_to_gitlab_description', { appName })}
            </p>
            <OLButton
              variant="secondary"
              href="/user/gitlab-sync/oauth2"
            >
              {t('link_to_gitlab')}
            </OLButton>
          </div>
        )}

        {showRepos && (
          <div>
            {repos.length === 0 ? (
              <p className="text-center">
                {t('you_dont_have_any_repositories')}
              </p>
            ) : (
              <>
                <p className="text-center">
                  {t('select_gitlab_repository', { appName })}
                </p>
                <div className="table-container table-container-bordered">
                  <table className="table table-striped table-hover">
                    <tbody>
                      {repos.map(repo => (
                        <tr key={repo.fullName}>
                          <td>
                            {repo.name}
                            <div className="small">
                              <a
                                href={`${gitlabUrl}/${repo.fullName}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {repo.fullName}
                              </a>
                            </div>
                          </td>
                          <td className="text-end">
                            <OLButton
                              variant="primary"
                              onClick={() => handleImport(repo)}
                            >
                              {t('import_to_sharelatex', { appName: 'Overleaf' })}
                            </OLButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {isErrorImport && (
          <div className="notification-list">
            <OLNotification
              type="error"
              content={t('something_went_wrong_server')}
            />
          </div>
        )}

      </OLModalBody>

      <OLModalFooter>
        {!isImporting && (
        <span className="me-auto">
          <a
            href="https://docs.gitlab.com/administration/settings/account_and_limit_settings/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('cant_see_what_youre_looking_for_question')}
          </a>
        </span>
        )}
        <OLButton
          variant="secondary"
          onClick={handleHide}
          disabled={isImporting}
        >
          {t('cancel')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default function ImportFromGitLabModal({ onHide }: { onHide: () => void }) {
  return (
    <OLModal
      id="git-import-modal"
      show
      animation
      size="lg"
      onHide={onHide}
      backdrop="static"
    >
      <ImportFromGitLabModalContent handleHide={onHide} />
    </OLModal>
  )
}
