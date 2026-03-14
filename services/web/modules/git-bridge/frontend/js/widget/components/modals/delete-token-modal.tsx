import { useTranslation } from 'react-i18next'
import { deleteJSON } from '@/infrastructure/fetch-json'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'

type Props = {
  show: boolean
  handleHide: () => void
  tokenId: string
  onDeleted: (id: string) => void
}

export default function DeleteTokenModal({
  show,
  handleHide,
  tokenId,
  onDeleted,
}: Props) {
  const { t } = useTranslation()

  const { isLoading, isError, runAsync, reset } = useAsync()

  const handleClose = () => {
    reset()
    handleHide()
  }

  const handleDelete = () => {
    runAsync(
      deleteJSON(`/git-bridge/personal-access-tokens/${tokenId}`, {
        body: { _csrf: window.csrfToken },
      })
    )
      .then(() => {
        onDeleted(tokenId)
        handleClose()
      })
      .catch(debugConsole.error)
  }

  return (
    <OLModal show={show} onHide={handleClose} backdrop="static">
      <OLModalHeader>
        <OLModalTitle>{t('delete_authentication_token')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <p>{t('delete_authentication_token_info')}</p>

        {isError && (
          <div className="notification-list">
            <Notification
              type="error"
              content={t('something_went_wrong_server')}
            />
          </div>
        )}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={handleClose} disabled={isLoading}>
          {t('cancel')}
        </OLButton>

        <OLButton variant="danger" onClick={handleDelete} disabled={isLoading}>
          {t('delete_token')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
