import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON, deleteJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLNotification from '@/shared/components/ol/ol-notification'
import ZoteroLogo from '@/shared/svgs/zotero-logo'

/**
 * Zotero account linking widget for the Account Settings page.
 * Instead of OAuth, users paste their Zotero API key directly.
 * Create one at https://www.zotero.org/settings/keys with:
 *   - "Allow library access"
 *   - "Allow read access to all groups" (for group library imports)
 *
 * Registered via overleafModuleImports.referenceLinkingWidgets.
 */
export const ZoteroWidget = function ZoteroWidget() {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  const {
    isLoading: isCheckingConn,
    isError: isErrorConnCheck,
    runAsync: runAsyncConnCheck,
    data: isConnected,
    setData: setConnState,
  } = useAsync<boolean>()

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const [showUnlinkModal, setShowUnlinkModal] = useState(false)

  const handleConnCheck = useCallback(() => {
    runAsyncConnCheck(getJSON('/user/zotero/status'))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleConnCheck()
  }, [handleConnCheck])

  const handleUnlink = useCallback(() => {
    runAsyncUnlink(deleteJSON('/user/zotero'))
      .then(() => setConnState(false))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
      .finally(() => setShowUnlinkModal(false))
  }, [runAsyncUnlink])

  if (isCheckingConn) {
    return (
      <div className="settings-widget-container">
        <div>
          <ZoteroLogo />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4>GitHub</h4>
          </div>

          <p className="small">
            <span>{t('loading')}…</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="settings-widget-container">
        <div>
          <ZoteroLogo size={40} />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="zotero-link">{t('zotero')}</h4>
          </div>

          <p className="small">
            {t('zotero_sync_description', { appName })}
          </p>

          {isErrorConnCheck && (
            <OLNotification
              type="error"
              content={t('problem_checking_connection_with_provider', { provider: t('zotero') })}
            />
          )}

          {isErrorUnlink && (
            <OLNotification
              type="error"
              content={t('generic_something_went_wrong')}
            />
          )}
        </div>

        <div>
          {isConnected ? (
            <OLButton
              variant="danger-ghost"
              onClick={() => setShowUnlinkModal(true)}
              disabled={isUnlinking}
            >
              {isUnlinking ? t('unlinking') : t('unlink')}
            </OLButton>
          ) : isErrorConnCheck ? (
            <OLButton
              variant="secondary"
              onClick={handleConnCheck}
            >
              {t('reconnect')}
            </OLButton>
          ) : (
            <OLButton
              variant="secondary"
              href="/user/zotero/oauth?popup=0"
            >
              {t('link')}
            </OLButton>
          )}
        </div>
      </div>

      <OLModal
        id="zotero-unlink-modal"
        show={showUnlinkModal}
        onHide={() => setShowUnlinkModal(false)}
        backdrop="static"
      >
        <OLModalHeader>
          <OLModalTitle>
            {t('unlink_reference', {
              provider: 'Zotero',
            })}
          </OLModalTitle>
        </OLModalHeader>

        <OLModalBody>
          <p>
            {t('unlink_warning_reference', {
              provider: 'Zotero',
            })}
          </p>
        </OLModalBody>

        <OLModalFooter>
          <OLButton
            variant="secondary"
            onClick={() => setShowUnlinkModal(false)}
          >
            {t('cancel')}
          </OLButton>

          <OLButton
            variant="danger-ghost"
            onClick={handleUnlink}
            disabled={isUnlinking}
          >
            {isUnlinking ? t('unlinking') : t('unlink')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}
