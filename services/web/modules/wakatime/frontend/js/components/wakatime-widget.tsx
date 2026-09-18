import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON, deleteJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import MaterialIcon from '@/shared/components/material-icon'
import WakaTimeConnectModal from './wakatime-connect-modal'

type WakaTimeStatus = { connected: boolean; apiUrl?: string; error?: boolean }

/**
 * WakaTime account linking widget for the Account Settings page.
 * Unlike Zotero/GitHub, there's no OAuth handshake: the user pastes an
 * API key (from wakatime.com or a self-hosted Wakapi instance) directly.
 *
 * Registered via overleafModuleImports.integrationLinkingWidgets.
 */
export const WakaTimeWidget = function WakaTimeWidget() {
  const { t } = useTranslation()

  const {
    isLoading: isCheckingConn,
    isError: isErrorConnCheck,
    runAsync: runAsyncConnCheck,
    data: status,
    setData: setStatus,
  } = useAsync<WakaTimeStatus>()

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const [showConnectModal, setShowConnectModal] = useState(false)

  const handleConnCheck = useCallback(() => {
    runAsyncConnCheck(getJSON('/user/wakatime/status')).catch(err =>
      debugConsole.error(err?.data?.message || err?.message || err)
    )
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleConnCheck()
  }, [handleConnCheck])

  const handleUnlink = useCallback(() => {
    runAsyncUnlink(deleteJSON('/user/wakatime'))
      .then(() => setStatus({ connected: false }))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [runAsyncUnlink, setStatus])

  if (isCheckingConn) {
    return (
      <div className="settings-widget-container">
        <div>
          <MaterialIcon type="schedule" size="2x" />
        </div>
        <div className="description-container">
          <div className="title-row">
            <h4>WakaTime</h4>
          </div>
          <p className="small">
            <span>{t('loading')}…</span>
          </p>
        </div>
      </div>
    )
  }

  const isConnected = !!status?.connected

  return (
    <>
      <div className="settings-widget-container">
        <div>
          <MaterialIcon type="schedule" size="2x" />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="wakatime-link">WakaTime</h4>
          </div>

          <p className="small">
            {t('wakatime_widget_description', {
              defaultValue:
                'Track coding time in your projects with WakaTime or a self-hosted Wakapi server.',
            })}
          </p>

          {isConnected && status?.apiUrl && (
            <p className="small text-muted">{status.apiUrl}</p>
          )}

          {isErrorConnCheck && (
            <OLNotification
              type="error"
              content={t('problem_checking_connection_with_provider', {
                provider: 'WakaTime',
              })}
            />
          )}

          {isErrorUnlink && (
            <OLNotification type="error" content={t('generic_something_went_wrong')} />
          )}
        </div>

        <div>
          {isConnected ? (
            <OLButton
              variant="danger-ghost"
              onClick={handleUnlink}
              disabled={isUnlinking}
            >
              {isUnlinking ? t('unlinking') : t('unlink')}
            </OLButton>
          ) : (
            <OLButton variant="secondary" onClick={() => setShowConnectModal(true)}>
              {t('link')}
            </OLButton>
          )}
        </div>
      </div>

      <WakaTimeConnectModal
        show={showConnectModal}
        handleHide={() => setShowConnectModal(false)}
        onLinked={handleConnCheck}
      />
    </>
  )
}
