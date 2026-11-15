import { useGitSync } from '../../git-sync-provider'
import getMeta from '@/utils/meta'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'

const GitSyncNeedAuthModal = ({ handleHide }: { handleHide: () => void }) => {
  const { t, provider, basePath } = useGitSync()
  const { appName } = getMeta('ol-ExposedSettings')
  return (
    <>
      <OLModalBody>
        <p>{t('link_to_github_description', { appName })}</p>
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
          onClick={() => {
            handleHide()
            window.open(
              `/user/${basePath}/oauth2`,
              `${provider}Auth`,
              'width=600,height=700'
            )
          }}
        >
          {t('link_to_github')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncNeedAuthModal
