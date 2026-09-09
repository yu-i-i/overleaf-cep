import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import GithubLogo from '@/shared/svgs/github-logo'
import GitServersList, { GitServer } from './git-servers-list'
import GitProviderModal from './git-provider-modal'

export const GitHubSyncWidget = function GitHubSyncWidget() {
  const { t } = useTranslation()
  const { appName, githubSyncEnabled } = getMeta('ol-ExposedSettings')

  const {
    isLoading: isCheckingConn,
    runAsync: runAsyncConnCheck,
    data: status,
  } = useAsync<{
    connected?: boolean
    providers?: GitServer[]
    oauth?: { linked?: boolean; username?: string }
  }>()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [listKey, setListKey] = useState(0)

  const {
    isLoading: unlinking,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const statusData = status || {}
  const isConnected =
    !!statusData.connected ||
    (statusData.providers || []).some(p => !p.source || p.source === 'pat') ||
    !!statusData.oauth?.linked

  // The widget's Unlink button manages the GitHub OAUTH account (the
  // dedicated OAuth slot). PAT accounts are managed per row in the table
  // below — the two never touch the same credential.
  const oauthLinked = !!statusData.oauth?.linked

  const handleStatusCheck = useCallback(() => {
    runAsyncConnCheck(getJSON('/user/github-sync/status')).catch(err =>
      debugConsole.error(err?.data?.message || err?.message || err),
    )
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleStatusCheck()
  }, [handleStatusCheck])

  const handleAdded = (_server: GitServer) => {
    // Refresh the connection status (provider count) and remount the list
    setListKey(key => key + 1)
    handleStatusCheck()
  }

  const unlinkGithub = () => {
    runAsyncUnlink(postJSON('/user/github-sync/unlink'))
      .then(() => {
        setShowUnlinkConfirm(false)
        // Refresh the provider list so the button reverts to "Link"
        setListKey(key => key + 1)
        handleStatusCheck()
      })
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
        setShowUnlinkConfirm(false)
      })
  }

  return (
    <>
      <div className="settings-widget-container">
        <div>
          <GithubLogo />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="github-sync">{t('git_sync')}</h4>
          </div>

          <p className="small">
            {t('git_sync_widget_description', { appName })}
          </p>

          {isCheckingConn ? <p className="small">{t('loading')}…</p> : null}
          {isConnected ? (
            <p className="small text-success">
              {t('git_providers_linked')}
            </p>
          ) : null}

          <GitServersList
            key={listKey}
            serversFilter={s => !s.source || s.source === 'pat'}
          />

          {/* Buttons live inside the description column (not the grid's
              actions column) so they stay inside the widget box instead of
              overflowing its right edge. The OAuth button ("Sign in with
              GitHub" flow) is only offered when the instance is configured
              with GitHub OAuth credentials (clientID + clientSecret). */}
          <div className="d-flex flex-column gap-2 mt-2">
            {githubSyncEnabled &&
              (oauthLinked ? (
                <OLButton
                  variant="danger-ghost"
                  disabled={unlinking}
                  loadingLabel={t('unlinking')}
                  onClick={() => setShowUnlinkConfirm(true)}
                >
                  {t('unlink_github_account')}
                </OLButton>
              ) : (
                <OLButton variant="secondary" href="/user/github-sync/oauth2">
                  {t('link_to_github')}
                </OLButton>
              ))}
            <OLButton variant="secondary" onClick={() => setShowAddModal(true)}>
              {t('add_new_provider')}
            </OLButton>
          </div>
        </div>
      </div>

      {showAddModal && (
        <GitProviderModal
          show
          title={t('add_new_provider')}
          onSuccess={handleAdded}
          onHide={() => setShowAddModal(false)}
        />
      )}

      <OLModal
        show={showUnlinkConfirm}
        header={t('unlink_github_account')}
        onHide={() => setShowUnlinkConfirm(false)}
      >
        <OLModalBody>
          {t('unlink_github_warning')}
        </OLModalBody>
        <OLModalFooter>
          <OLButton
            variant="secondary"
            disabled={unlinking}
            onClick={() => setShowUnlinkConfirm(false)}
          >
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="danger"
            disabled={unlinking}
            loadingLabel={t('unlinking')}
            onClick={unlinkGithub}
          >
            {t('unlink')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}

export default GitHubSyncWidget
