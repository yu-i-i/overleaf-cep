import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import GitServersList, { GitServer } from '../git-servers-list'
import GitProviderModal from '../git-provider-modal'

type GitSyncNeedAuthModalProps = {
  handleHide: () => void
  selectServer: (server: GitServer) => void
}

/**
 * Shown when the project is not yet synced. The user picks one of their
 * registered git providers (Link) or registers a new one with a personal
 * access token.
 */
const GitSyncNeedAuthModal = ({ handleHide, selectServer }: GitSyncNeedAuthModalProps) => {
  const { t } = useTranslation()
  const [showProviderModal, setShowProviderModal] = useState(false)
  const [linkedServer, setLinkedServer] = useState<GitServer | null>(null)
  const [listKey, setListKey] = useState(0)

  const handleLink = (server: GitServer) => {
    setLinkedServer(server)
    selectServer(server)
  }

  const handleProviderAdded = (server: GitServer) => {
    setShowProviderModal(false)
    setListKey(key => key + 1)
    setLinkedServer(server)
    selectServer(server)
  }

  return (
    <>
      <OLModalBody>
        <p>{t('git_select_provider_to_link')}</p>

        <GitServersList key={listKey} showTest={false} showDelete={false} showLink onLink={handleLink} />

        <div style={{ marginTop: '1rem' }}>
          <OLButton variant="secondary" onClick={() => setShowProviderModal(true)}>
            {t('new_provider')}
          </OLButton>
        </div>

        {linkedServer && (
          <p className="small">{t('link_git_sync_account')}</p>
        )}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={handleHide}>
          {t('cancel')}
        </OLButton>
      </OLModalFooter>

      {showProviderModal && (
        <GitProviderModal
          show
          title={t('new_provider')}
          onSuccess={handleProviderAdded}
          onHide={() => setShowProviderModal(false)}
        />
      )}
    </>
  )
}

export default GitSyncNeedAuthModal
