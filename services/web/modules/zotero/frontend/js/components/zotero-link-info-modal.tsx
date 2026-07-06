import { useTranslation, Trans } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { deleteJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import { useState, useEffect, useCallback } from 'react'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'

import { ProjectSyncState, GitSyncModalStatus } from '../../types/git-sync-types'

type ZoteroLinkInfoModalModalProps = {
  show: boolean
  isError: any
  handleHide: () => void
}

const ZoteroLinkInfoModal = ({ show, isError, handleHide }: ZoteroLinkInfoModalProps) => {
  const { t } = useTranslation()
  const [showUnlinkInfo, setShowUnlinkInfo] = useState(false)

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const handleUnlink = () => {
    runAsyncUnlink(deleteJSON('/user/zotero'))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
    handleHide()
  }

  useEffect(() => {
    if (!show) return
    setShowUnlinkInfo(false)
  }, [show])

  return (
    <>
      <OLModal show={show} onHide={handleHide} backdrop="static">
      <OLModalHeader closeButton>
        <OLModalTitle>{t('zotero_integration')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {showUnlinkInfo ? (
          <OLNotification
            type="warning"
            content={t('unlink_warning_reference', { provider: t('zotero') })}
          />
        ) : isError ? (
          <OLNotification
            type="error"
            content={t('problem_checking_connection_with_provider', {
              provider: t('zotero'),
            })}
          />
        ) : (
          <OLNotification
            type="info"
            content={
              <Trans
                i18nKey="you_currently_have_x_linked_with_your_overleaf_account"
                values={{ managers: t('zotero') }}
                components={[<b />]}
              />
            }
          />
        )}
      </OLModalBody>

      <OLModalFooter>
        {showUnlinkInfo ? (
          <OLButton
            variant="danger"
            disabled={isUnlinking}
            onClick={handleUnlink}
          >
            {t('confirm')}
          </OLButton>
        ) : (
          <OLButton
            variant="danger-ghost"
            disabled={isUnlinking}
            onClick={() => setShowUnlinkInfo(true)}
          >
            {t('unlink')}
          </OLButton>
        )}
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
      </OLModalFooter>
      </OLModal>
    </>
  )
}

export default ZoteroLinkInfoModal
