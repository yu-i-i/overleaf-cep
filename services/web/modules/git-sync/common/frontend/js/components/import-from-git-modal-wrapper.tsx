import { type GitSyncConfig, GitSyncProvider, useGitSync } from '../git-sync-provider'
import React, { useEffect, useState } from 'react'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import { postJSON, getJSON } from '@/infrastructure/fetch-json'
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
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import GitSyncDropdown from './git-sync-dropdown'
import Notification from '@/shared/components/notification'

type GitSyncRepo = {
  name: string
  fullName: string
  defaultBranchName: string
}

type GitSyncReposResponse = {
  repos?: GitSyncRepo[]
}

function ImportFromGitModalContent({ handleHide }: { handleHide: () => void }) {
  const { t, basePath } = useGitSync()
  const { appName } = getMeta('ol-ExposedSettings')
  const [retryProjectId, setRetryProjectId] = useState<string | null>(null)
  const [requestError, setRequestError] = useState('')
  const [selectedOwner, setSelectedOwner] = useState('')
  const [selectedRepo, setSelectedRepo] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [branchError, setBranchError] = useState(false)

  const { isLoading, isSuccess, isError, data, runAsync } = useAsync<GitSyncReposResponse>()

  useEffect(() => {
    runAsync(getJSON(`/user/${basePath}/repos`))
      .catch(err => setRequestError(err?.data?.message || ''))
  }, [basePath, runAsync])

  const reposExist = data?.repos != null
  const repos = data?.repos || []
  const owners = [...new Set(repos.map(repo => repo.fullName.slice(0, repo.fullName.lastIndexOf('/'))))].sort()
  const ownerRepos = repos.filter(repo => repo.fullName.slice(0, repo.fullName.lastIndexOf('/')) === selectedOwner)
  const repo = ownerRepos.find(repo => repo.fullName === selectedRepo)

  useEffect(() => {
    if (!selectedRepo) return
    let active = true
    setLoadingBranches(true)
    setBranchError(false)
    getJSON<{ branches: string[] }>(`/user/${basePath}/repos/branches?repo=${encodeURIComponent(selectedRepo)}`)
      .then(({ branches }) => {
        if (active) setBranches(branches)
      })
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
        if (active) {
          setBranchError(true)
          setRequestError(err?.data?.message || '')
        }
      })
      .finally(() => {
        if (active) setLoadingBranches(false)
      })
    return () => { active = false }
  }, [basePath, selectedRepo])

  const {
    isLoading: isImporting,
    isError: isErrorImport,
    runAsync: runAsyncImport,
  } = useAsync<{ projectId: string, linked: boolean }>()

  const handleImport = () => {
    if (!repo && !retryProjectId) return
    runAsyncImport(postJSON(`/project/new/${basePath}`, {
      body: retryProjectId ? { retryProjectId } : { ...repo, defaultBranchName: selectedBranch || repo?.defaultBranchName },
    }))
      .then(({ projectId, linked }) => {
        if (linked) window.location.href = `/project/${projectId}`
        else setRetryProjectId(projectId)
      })
      .catch(err => setRequestError(err?.data?.message || ''))
  }

  return (
    <>
      <OLModalHeader onClose={handleHide}>
        <OLModalTitle>{t('import_from_github')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {isLoading && (
          <span>
            <OLSpinner size="sm" className="me-2" />
            {t('loading_github_repositories')}
          </span>
        )}

        {isImporting && (
          <span>
            <OLSpinner size="sm" className="me-2" />
            {t('importing')}
          </span>
        )}

        {isError && (
          <Notification type="error" content={requestError || t('something_went_wrong_server')} />
        )}

        {isSuccess && !reposExist && (
          <div className="text-center">
            <p>{t('link_to_github_description', { appName })}</p>
            <OLButton variant="secondary" href={`/user/${basePath}/oauth2`}>
              {t('link_to_github')}
            </OLButton>
          </div>
        )}

        {retryProjectId && (
          <>
            <Notification type="error" content={t('github_sync_import_link_failed')} />
            <div className="mt-2">
              <a href={`/project/${retryProjectId}`}>{t('open_project')}</a>
            </div>
          </>
        )}

        {!retryProjectId && isSuccess && reposExist && !isImporting && (repos.length === 0 ? (
          <p className="text-center">{t('you_dont_have_any_repositories')}</p>
        ) : (
          <>
            <OLFormGroup>
              <OLFormLabel htmlFor={`${basePath}-owner`}>
                {t('owner')} / {t('organization')}
              </OLFormLabel>
              <GitSyncDropdown
                id={`${basePath}-owner`}
                value={selectedOwner}
                options={[{ value: '', label: t('select') }, ...owners.map(owner => ({ value: owner, label: owner }))]}
                onChange={owner => {
                  setSelectedOwner(owner)
                  setSelectedRepo('')
                  setSelectedBranch('')
                  setBranches([])
                  setBranchError(false)
                }}
              />
            </OLFormGroup>

            <OLFormGroup>
              <OLFormLabel htmlFor={`${basePath}-repo`}>{t('repository_name')}</OLFormLabel>
              <GitSyncDropdown
                id={`${basePath}-repo`}
                value={selectedRepo}
                disabled={!selectedOwner}
                options={[{ value: '', label: t('select') }, ...ownerRepos.map(repo => ({ value: repo.fullName, label: repo.name }))]}
                onChange={repo => {
                  setSelectedRepo(repo)
                  setSelectedBranch('')
                  setBranches([])
                  setBranchError(false)
                }}
              />
            </OLFormGroup>

            <OLFormGroup>
              <OLFormLabel htmlFor={`${basePath}-branch`}>
                {t('github_sync_branch_name')}
              </OLFormLabel>
              <GitSyncDropdown
                id={`${basePath}-branch`}
                value={selectedBranch || repo?.defaultBranchName || ''}
                placeholder={t('select')}
                disabled={!repo || loadingBranches}
                options={repo ? [
                  { value: repo.defaultBranchName, label: repo.defaultBranchName },
                  ...branches.filter(branch => branch !== repo.defaultBranchName).map(branch => ({ value: branch, label: branch })),
                ] : []}
                onChange={setSelectedBranch}
              />
              {loadingBranches && <OLSpinner size="sm" className="ms-2" />}
              {branchError && <Notification type="error" content={requestError || t('something_went_wrong_server')} />}
            </OLFormGroup>
          </>
        ))}

        {isErrorImport && (
          <Notification type="error" content={requestError || t('something_went_wrong_server')} />
        )}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={handleHide} disabled={isImporting}>
          {t('cancel')}
        </OLButton>
        <OLButton
          variant="primary"
          onClick={handleImport}
          disabled={(!repo && !retryProjectId) || isImporting || loadingBranches}
          isLoading={isImporting}
        >
          {retryProjectId ? t('github_sync_retry_link') : t('import')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default function ImportFromGitModal({ onHide, config }: { onHide: () => void, config: GitSyncConfig }) {
  return (
    <GitSyncProvider config={config}>
      <OLModal
        id={`${config.provider}-import-modal`}
        show
        animation
        onHide={onHide}
        backdrop="static"
        themed
      >
        <ImportFromGitModalContent handleHide={onHide} />
      </OLModal>
    </GitSyncProvider>
  )
}
