import { useTranslation, Trans } from 'react-i18next'
import Notification from '@/shared/components/notification'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { ProjectSyncState } from '../../types/git-sync-types'
import getMeta from '@/utils/meta'

type GitSyncNeedPermissionModalProps = {
  projectSyncState: ProjectSyncState
  handleHide: () => void
}

const GitSyncNeedPermissionModal = ({ projectSyncState, handleHide }: GitSyncNeedPermissionModalProps) => {
  const { t } = useTranslation()
  let gitlabUrl = getMeta('ol-ExposedSettings').gitlabUrl || ''
  gitlabUrl = gitlabUrl.endsWith('/') ? gitlabUrl.slice(0, -1) : gitlabUrl
  return (
    <>
      <OLModalBody>
        <Notification
          type="warning"
          content={(
            <Trans
              i18nKey="ask_proj_owner_to_add_you_as_gitlab_collaborator"
              values={{
                repoFullName: projectSyncState.repoFullName ?? '?',
                projectOwnerEmail: projectSyncState.ownerEmail ?? '?',
              }}
              components={[
                projectSyncState.repoFullName ? (
                  <a
                    href={`${gitlabUrl}/${projectSyncState.repoFullName}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  />
                ) : (
                  <></>
                ),
                projectSyncState.ownerEmail ? <a href={`mailto:${projectSyncState.ownerEmail}`} /> : <></>
              ]}
            />
          )}
        />
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

export default GitSyncNeedPermissionModal
