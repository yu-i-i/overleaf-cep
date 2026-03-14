import { Trans, useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'

type Props = {
  secretToken: string
  handleHide: () => void
}

export default function ExposeTokenModal({
  secretToken,
  handleHide,
}: Props) {
  const { t } = useTranslation()

  return (
    <OLModal
      show
      onHide={handleHide}
      backdrop="static"
      id="create-token-modal"
    >
      <OLModalHeader closeButton>
        <OLModalTitle>
          {t('git_authentication_token')}
        </OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <p>
          {t('git_authentication_token_create_modal_info_1')}
        </p>

        <div className="text-center">
          <div className="git-bridge-copy">
            <span aria-label={t('git_authentication_token')}>
               <code>{secretToken}</code>
            </span>
            <CopyToClipboard
              content={secretToken}
              tooltipId="git-auth-token-copy"
              kind="text"
            />
          </div>
        </div>

        <p>
          <Trans
            i18nKey="git_authentication_token_create_modal_info_2"
            components={[
              <strong key="strong" />,
              <a
                key="link"
                href="/learn/how-to/Git_integration_authentication_tokens"
                target="_blank"
                rel="noreferrer noopener"
              />,
            ]}
          />
        </p>
      </OLModalBody>

      <OLModalFooter>
        <OLButton
          variant="primary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
