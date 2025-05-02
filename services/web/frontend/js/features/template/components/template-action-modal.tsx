import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Template } from '../../../../../types/template'
import { getUserFacingMessage } from '@/infrastructure/fetch-json'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import * as eventTracking from '@/infrastructure/event-tracking'
import { isSmallDevice } from '@/infrastructure/event-tracking'
import Notification from '@/shared/components/notification'
import OLButton from '@/features/ui/components/ol/ol-button'
import OLModal, {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/features/ui/components/ol/ol-modal'

type TemplateActionModalProps = {
  title?: string
  action: 'delete' | 'edit'
  actionHandler: (template: Template) => Promise<void>
  handleCloseModal: () => void
  template: Template
  showModal: boolean
  children?: React.ReactNode
  renderFooterButtons?: (props: {
    onConfirm: () => void
    onCancel: () => void
    isProcessing: boolean
  }) => React.ReactNode
  onClearError?: (clear: () => void) => void
}

function TemplateActionModal({
  title,
  action,
  actionHandler,
  handleCloseModal,
  showModal,
  template,
  children,
  renderFooterButtons,
  onClearError,
}: TemplateActionModalProps) {
  const { t } = useTranslation()
  const [error, setError] = useState<false | { name: string; error: unknown }>(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const isMounted = useIsMounted()

  useEffect(() => {
    if (onClearError) {
      onClearError(() => setError(false))
    }
  }, [onClearError])

  async function handleActionForTemplate(template: Template) {
    let errored
    setIsProcessing(true)
    setError(false)

    try {
      await actionHandler(template)
    } catch (e) {
      errored = { name: template.name, error: e }
    }

    if (isMounted.current) {
      setIsProcessing(false)
    }

    if (!errored) {
      handleCloseModal()
    } else {
      setError(errored)
    }
  }

  useEffect(() => {
    if (showModal) {
      eventTracking.sendMB('template-info-page-interaction', {
        action,
        isSmallDevice,
      })
    } else {
     setError(false)
    }
  }, [action, showModal])

  return (
    <OLModal
      animation
      show={showModal}
      onHide={handleCloseModal}
      id="action-tempate-modal"
      backdrop="static"
    >
      <OLModalHeader closeButton>
        <OLModalTitle>{title}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {children}
        {!isProcessing && error && (
          <Notification
            type="error"
            title={error.name}
            content={getUserFacingMessage(error.error) as string}
          />
        )}
      </OLModalBody>
      <OLModalFooter>
        {renderFooterButtons ? (
          renderFooterButtons({
            onConfirm: () => handleActionForTemplate(template),
            onCancel: handleCloseModal,
            isProcessing,
          })
        ) : (
          <>
            <OLButton variant="secondary" onClick={handleCloseModal}>
              {t('cancel')}
            </OLButton>
            <OLButton
              variant="danger"
              onClick={() => handleActionForTemplate(template)}
              disabled={isProcessing}
            >
              {t('confirm')}
            </OLButton>
          </>
        )}
      </OLModalFooter>
    </OLModal>
  )
}

export default memo(TemplateActionModal)

