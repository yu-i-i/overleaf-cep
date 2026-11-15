import { useGitSync } from '../../git-sync-provider'
import { useState, useEffect } from 'react'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import {
  getJSON,
  postJSON
} from '@/infrastructure/fetch-json'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import GitSyncDropdown from '../git-sync-dropdown'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import { GitSyncModalStatus } from '../../types/git-sync-types'

type OrgsResponse = {
  user: string
  orgs: string[]
}

type GitSyncExportModalProps = {
  projectId: string
  projectName: string
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
}

const GitSyncExportModal = ({
  projectId,
  projectName,
  handleHide,
  setModalStatus
}: GitSyncExportModalProps) => {
  const { t, provider, basePath } = useGitSync()

  const [selectedOwner, setSelectedOwner] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [repoName, setRepoName] = useState(projectName)
  const [description, setDescription] = useState('')
  const [branchName, setBranchName] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')

  const {
    runAsync: runAsyncUserAndOrgs,
    data: userAndOrgs,
    error: errorUserAndOrgs
  } = useAsync<OrgsResponse>()

  useEffect(() => {
    runAsyncUserAndOrgs(getJSON(`/user/${basePath}/orgs`))
      .then(userAndOrgs => setSelectedOwner(userAndOrgs?.user))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [])

  const { isLoading, error, setError, runAsync } = useAsync<void>()

  const createRepo = () => {
    const isPublic = visibility === 'public'
    const org = selectedOwner === userAndOrgs?.user ? undefined : selectedOwner

    runAsync(postJSON(`/project/${projectId}/${basePath}/export`, {
      body: {
        name: repoName,
        description,
        branchName: branchName.trim() || 'main',
        isPublic,
        org,
      },
    }))
      .then(() => setModalStatus('loading'))
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
        if (err?.info?.statusCode === 429) setError(err?.data?.message || 'Git provider rate limit reached. Wait before exporting again.')
        else if (!err?.data?.key) setError(t('something_went_wrong_server'))
        else setError(t(err.data.key))
      })
  }

  return (
    <>
      <OLModalBody>
        <h4>{t('export_project_to_github')}</h4>
        <p>{t('project_not_linked_to_github')}</p>

        {error && (
          <Notification
            type="error"
            content={error}
          />
        )}

        {errorUserAndOrgs && (
          <Notification
            type="error"
            content={t('something_went_wrong_server')}
          />
        )}

        <OLForm onSubmit={createRepo}>
          <OLRow>
            <OLCol xs={4}>
              <OLFormGroup>
                <OLFormLabel htmlFor={`${basePath}-owner`}>
                  {selectedOwner === userAndOrgs?.user
                    ? t('owner')
                    : t('organization')}
                </OLFormLabel>
                <GitSyncDropdown
                  id={`${basePath}-owner`}
                  value={selectedOwner}
                  placeholder={t('loading')}
                  disabled={!userAndOrgs}
                  options={[
                    ...(userAndOrgs?.user ? [{ value: userAndOrgs.user, label: userAndOrgs.user }] : []),
                    ...(userAndOrgs?.orgs || []).map(org => ({ value: org, label: org })),
                  ]}
                  onChange={setSelectedOwner}
                />
              </OLFormGroup>
            </OLCol>

            <OLCol xs={4}>
              <OLFormGroup>
                <OLFormLabel htmlFor={`${basePath}-name`}>
                  {t('repository_name')}
                </OLFormLabel>
                <OLFormControl
                  id={`${basePath}-name`}
                  name="name"
                  type="text"
                  value={repoName}
                  onChange={e => setRepoName(e.target.value)}
                />
              </OLFormGroup>
            </OLCol>

            <OLCol xs={4}>
              <OLFormGroup>
                <OLFormLabel htmlFor={`${basePath}-branch`}>
                  {t('github_sync_branch_name')}
                </OLFormLabel>
                <OLFormControl
                  id={`${basePath}-branch`}
                  name="branch"
                  type="text"
                  value={branchName}
                  placeholder="main"
                  onChange={e => setBranchName(e.target.value)}
                />
              </OLFormGroup>
            </OLCol>
          </OLRow>

          <OLRow>
            <OLCol xs={12}>
              <OLFormGroup>
                <OLFormLabel htmlFor={`${basePath}-description`}>
                  {t('description')} ({t('optional')})
                </OLFormLabel>
                <OLFormControl
                  id={`${basePath}-description`}
                  name="description"
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </OLFormGroup>
            </OLCol>
          </OLRow>

          <hr />

          <fieldset>
            <legend className="visually-hidden">
              {t('repository_visibility')}
            </legend>

            <OLFormGroup>
              <OLRow>
                <OLCol xs={12}>
                  <OLFormCheckbox
                    type="radio"
                    id="public"
                    name="repository"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={() => setVisibility('public')}
                    label={t('public')}
                    description={t('github_public_description')}
                  />
                </OLCol>
              </OLRow>

              <OLRow>
                <OLCol xs={12}>
                  <OLFormCheckbox
                    className="mr-1"
                    type="radio"
                    id="private"
                    name="repository"
                    value="private"
                    checked={visibility === 'private'}
                    onChange={() => setVisibility('private')}
                    label={t('private')}
                    description={t('github_private_description')}
                  />
                </OLCol>
              </OLRow>
            </OLFormGroup>
          </fieldset>
        </OLForm>
      </OLModalBody>

      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('cancel')}
        </OLButton>

        <OLButton
          variant="primary"
          onClick={createRepo}
          disabled={!repoName.trim() || isLoading}
          isLoading={isLoading}
        >
          {t('create_project_in_github')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncExportModal
