import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import MaterialIcon from '@/shared/components/material-icon'
import WebDAVSettingsModal from './settings-webdav-modal'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'

export default function WebDAVIntegrationCard() {
  const { t } = useTranslation()
  const { admin } = usePermissionsContext()
  const [showModal, setShowModal] = useState(false)

  const webdavConfig = getMeta('ol-webdavConfig')

  if (!admin) return null

  const isLinked = webdavConfig?.enabled && webdavConfig?.url

  return (
    <>
      <IntegrationCard
        title={t('cloud_storage')}
        description={
          isLinked
            ? webdavConfig.url
            : t('setup_cloud_storage')
        }
        icon={<MaterialIcon type="cloud_sync" />}
        onClick={() => setShowModal(true)}
        showPaywallBadge={false}
      />

      <WebDAVSettingsModal
        show={showModal}
        onClose={() => setShowModal(false)}
        currentConfig={webdavConfig}
      />
    </>
  )
}
