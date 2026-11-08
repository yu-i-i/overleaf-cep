import { useGitSync } from '../../git-sync-provider'
import { Trans } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'

import { ProjectSyncState, GitSyncModalStatus } from '../../types/git-sync-types'

type GitSyncConflictModalProps = {
  errorMessage: string | null
  projectSyncState: ProjectSyncState
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
}

const GitSyncConflictModal = ({ errorMessage, projectSyncState, handleHide, setModalStatus }: GitSyncConflictModalProps) => {
  const { t, providerName } = useGitSync()
  const { appName } = getMeta('ol-ExposedSettings')

  return (
    <>
      <OLModalBody>
        {errorMessage && <Notification type="error" content={errorMessage} />}
        <Notification
          type="warning"
          content={t('github_merge_failed_error', { appName })}
        />
        <p className="mt-2">
          <Trans
            i18nKey="github_sync_merge_into_linked_branch"
            values={{ provider: providerName, source: projectSyncState.unmergedBranchName, target: projectSyncState.defaultBranchName }}
            components={[<b />, <b />]}
          />
        </p>
        <p>
          <Trans
            i18nKey="github_sync_manual_resolution_allowed"
            values={{ branch: projectSyncState.defaultBranchName }}
            components={[<b />]}
          />
        </p>
      </OLModalBody>
      <OLModalFooter>
        {errorMessage && (
          <OLButton variant="danger-ghost" onClick={() => setModalStatus('confirm-unlink')}>
            {t('unlink')}
          </OLButton>
        )}
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
        <OLButton
          variant="primary"
          onClick={
            () => setModalStatus('run-merge-resolved')
          }
        >
          {t('continue_github_merge')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncConflictModal
