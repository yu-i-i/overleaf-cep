import { useGitSync } from '../../git-sync-provider'
import { Trans } from 'react-i18next'
import Notification from '@/shared/components/notification'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { ProjectSyncState } from '../../types/git-sync-types'

type GitSyncNeedPermissionModalProps = {
  projectSyncState: ProjectSyncState
  handleHide: () => void
}

const GitSyncNeedPermissionModal = ({ projectSyncState, handleHide }: GitSyncNeedPermissionModalProps) => {
  const { t, provider, providerName, repoUrl } = useGitSync()
  return (
    <>
      <OLModalBody>
        <Notification
          type="warning"
          content={(
            <Trans
              i18nKey="ask_proj_owner_to_add_you_as_github_collaborator"
              values={{ provider: providerName, 
                repoFullName: projectSyncState.repoFullName ?? '?',
                projectOwnerEmail: projectSyncState.ownerEmail ?? '?',
              }}
              components={[
                projectSyncState.repoFullName ? (
                  <a
                    href={repoUrl(projectSyncState.repoFullName)}
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
