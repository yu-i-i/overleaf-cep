import { useTranslation } from 'react-i18next'
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
import OLNotification from '@/shared/components/ol/ol-notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import { GitSyncModalStatus } from '../../types/git-sync-types'
import { GitServer } from '../git-servers-list'

type GitSyncExportModalProps = {
  projectId: string
  projectName: string
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
  server?: GitServer | null
}

const GitSyncExportModal = ({
  projectId,
  projectName,
  handleHide,
  setModalStatus,
  server
}: GitSyncExportModalProps) => {
  const { t } = useTranslation()

  const [servers, setServers] = useState<GitServer[]>([])
  const [providerId, setProviderId] = useState('')
  const [repoName, setRepoName] = useState(projectName)
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')

  // Linked providers the user can export to (same endpoint as the settings list)
  useEffect(() => {
    getJSON<GitServer[]>('/user/git-servers')
      .then(data => setServers(Array.isArray(data) ? data : []))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [])

  // Candidates: the preselected server (e.g. arriving from the auth flow) first,
  // then the user's linked providers; dedupe by id.
  const candidates: GitServer[] = (() => {
    if (!servers.length) return server ? [server] : []
    if (server && !servers.some(s => s.id === server.id)) return [server, ...servers]
    return servers
  })()

  // Preselect: the incoming server when available, otherwise the first linked provider
  useEffect(() => {
    if (!candidates.length) return
    if (candidates.some(s => s.id === providerId)) return
    const preferred = server?.id && candidates.find(s => s.id === server.id)
    setProviderId((preferred || candidates[0]).id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates])

  const active: GitServer | null =
    candidates.find(s => s.id === providerId) || candidates[0] || server || null

  const { isLoading, error, setError, runAsync } = useAsync<void>()

  const createRepo = () => {
    const isPublic = visibility === 'public'

    // The repository is always created in the linked account's personal space
    // (the account the provider's token belongs to); the owner is shown on the
    // provider option instead of being selectable per export.
    runAsync(postJSON(`/project/${projectId}/github-sync/export`, {
      body: {
        name: repoName,
        description,
        isPublic,
        provider: active?.provider,
        serverUrl: active?.url,
        username: active?.username,
      },
    }))
      .then(() => setModalStatus('loading'))
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
        if (!err?.data?.key) setError(t('something_went_wrong_server'))
        else setError(t(err.data.key))
      })
  }

  return (
    <>
      <OLModalBody>
        <h4>{t('export_project_to_github')}</h4>
        <p>{t('project_not_linked_to_github')}</p>

        {error && (
          <OLNotification
            type="error"
            content={error}
          />
        )}

        <OLForm onSubmit={createRepo}>
          {candidates.length >= 1 && (
            <OLRow>
              <OLCol xs={12}>
                <OLFormGroup>
                  <OLFormLabel htmlFor="github-sync-provider">
                    {t('provider')}
                  </OLFormLabel>
                  <OLFormSelect
                    id="github-sync-provider"
                    name="provider"
                    value={active?.id || ''}
                    onChange={e => setProviderId(e.target.value)}
                  >
                    {candidates.map(s => (
                      <option key={s.id} value={s.id}>
                        {t(s.provider)}{s.username ? ` (${s.username})` : ''}
                        {s.source === 'oauth' ? ` — OAuth` : ''} — {s.url}
                      </option>
                    ))}
                  </OLFormSelect>
                </OLFormGroup>
              </OLCol>
            </OLRow>
          )}

          <OLRow>
            <OLCol xs={12}>
              <OLFormGroup>
                <OLFormLabel htmlFor="github-sync-name">
                  {t('repository_name')}
                </OLFormLabel>
                <OLFormControl
                  id="github-sync-name"
                  name="name"
                  type="text"
                  value={repoName}
                  onChange={e => setRepoName(e.target.value)}
                />
              </OLFormGroup>
            </OLCol>
          </OLRow>

          <OLRow>
            <OLCol xs={12}>
              <OLFormGroup>
                <OLFormLabel htmlFor="github-sync-description">
                  {t('description')} ({t('optional')})
                </OLFormLabel>
                <OLFormControl
                  id="github-sync-description"
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
                    label={t('public', { defaultValue: 'Public' })}
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
                    label={t('private', { defaultValue: 'Private' })}
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
          loadingLabel={t('creating')}
        >
          {t('create_project_in_github')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncExportModal
