import React, { useEffect, useState } from 'react'
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
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import { GitServer } from './git-servers-list'

type GitSyncRepo = {
  name: string
  fullName: string
  defaultBranchName: string
}

type GitSyncReposResponse = {
  repos?: GitSyncRepo[]
}

function ImportFromGitHubModalContent({ handleHide }: { handleHide: () => void }) {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  // Linked providers (PAT accounts + the GitHub OAuth slot) — the user picks
  // WHICH account's repositories to import from.
  const [providers, setProviders] = useState<GitServer[]>([])
  const [providerId, setProviderId] = useState('')
  const selectedProvider = providers.find(p => p.id === providerId) || null

  useEffect(() => {
    getJSON<{ providers?: GitServer[] }>('/user/github-sync/status')
      .then(res => {
        setProviders(Array.isArray(res?.providers) ? res.providers : [])
      })
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [])

  // Keep a selection once providers are known (prefer the first entry)
  useEffect(() => {
    if (providers.length && !providers.some(p => p.id === providerId)) {
      setProviderId(providers[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers])

  const {
    isLoading,
    isSuccess,
    isError,
    data,
    runAsync,
  } = useAsync<GitSyncReposResponse>()

  useEffect(() => {
    const url = selectedProvider
      ? `/user/github-sync/repos?provider=${encodeURIComponent(selectedProvider.provider)}` +
        `&serverUrl=${encodeURIComponent(selectedProvider.url)}` +
        (selectedProvider.username
          ? `&username=${encodeURIComponent(selectedProvider.username)}`
          : '')
      : '/user/github-sync/repos'
    runAsync(getJSON(url))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [runAsync, providerId, selectedProvider])

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

  const showLinkToGitHub = !isImporting && isSuccess && !reposExist
  const showRepos = !isImporting && isSuccess && reposExist

  const handleImport = (repo: GitSyncRepo) => {

    runAsyncImport(
      postJSON('/project/new/github-sync', {
        body: {
          ...repo,
          provider: selectedProvider?.provider,
          serverUrl: selectedProvider?.url,
          username: selectedProvider?.username,
        },
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
        <OLModalTitle>{t('import_from_github')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {providers.length > 0 && (
          <OLRow>
            <OLCol xs={12}>
              <OLFormGroup>
                <OLFormLabel htmlFor="github-import-provider">
                  {t('import_from')}
                </OLFormLabel>
                <OLFormSelect
                  id="github-import-provider"
                  value={providerId}
                  onChange={e => setProviderId(e.target.value)}
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {t(p.provider)}{p.username ? ` (${p.username})` : ''}
                      {p.source === 'oauth' ? ' — OAuth' : ''} — {p.url}
                    </option>
                  ))}
                </OLFormSelect>
              </OLFormGroup>
            </OLCol>
          </OLRow>
        )}

        {isLoading && (
          <span>
            <OLSpinner size="sm" className="me-2"/>
            {t('loading_github_repositories')}
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

        {showLinkToGitHub && (
          <div className="text-center">
            <p>
              {t('link_to_github_description', { appName })}
            </p>
            <OLButton
              variant="secondary"
              href="/user/github-sync/oauth2"
            >
              {t('link_to_github')}
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
                  {t('select_github_repository', { appName })}
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
                                href={`https://github.com/${repo.fullName}`}
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
            href="https://help.github.com/en/articles/requesting-organization-approval-for-oauth-apps"
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

export default function ImportFromGitHubModal({ onHide }: { onHide: () => void }) {
  return (
    <OLModal
      id="git-import-modal"
      show
      animation
      size="lg"
      onHide={onHide}
      backdrop="static"
    >
      <ImportFromGitHubModalContent handleHide={onHide} />
    </OLModal>
  )
}
