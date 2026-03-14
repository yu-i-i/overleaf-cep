import { Trans, useTranslation } from 'react-i18next'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'

import {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'

type Props = {
  handleHide: () => void
  projectId: string
}

export default function GitModalContent({
  handleHide,
  projectId,
}: Props) {
  const { t } = useTranslation()

  const gitCloneCommand = `git clone ${window.location.protocol}//git@${window.location.host}/git/${projectId}`

  return (
    <>
      <OLModalHeader closeButton>
        <OLModalTitle>{t('clone_with_git')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <p>{t('git_bridge_modal_git_clone_your_project')}</p>

        <div className="git-bridge-copy">
          <span aria-label={t('git_clone_project_command')}>
            <code>
              {gitCloneCommand}
            </code>
          </span>
          <CopyToClipboard 
            content={gitCloneCommand} 
            tooltipId="git-copy-clone-project-command-tooltip"
          />
        </div>
        <Trans
          i18nKey="git_bridge_modal_use_previous_token"
          components={[
            <a
              href="/learn/how-to/Git_integration_authentication_tokens"
              target="_blank"
              rel="noreferrer noopener"
            />,
          ]}
        />
      </OLModalBody>

      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
        <OLButton
          variant="primary"
          href="/user/settings"
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('go_to_settings')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}
