import { ElementType } from 'react'
import importOverleafModules from '../../../macros/import-overleaf-module.macro'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import getMeta from '../../utils/meta'

const allIntegrationPanelComponents = importOverleafModules(
  'integrationPanelComponents'
) as { import: { default: ElementType }; path: string }[]

const integrationPanelComponents = allIntegrationPanelComponents.filter(
  ({ path }) =>
    (getMeta('ol-gitBridgeEnabled') || !path.includes('git-bridge')) &&
    (getMeta('ol-ExposedSettings').githubSyncEnabled || !path.includes('github-sync')) &&
    (getMeta('ol-ExposedSettings').zoteroEnabled || !path.includes('zotero'))
)

export default function IntegrationsPanel() {
  const { t } = useTranslation()

  return (
    <div className="integrations-panel">
      <RailPanelHeader title={t('integrations')} />
      {integrationPanelComponents.map(
        ({ import: { default: Component }, path }) => (
          <Component key={path} />
        )
      )}
    </div>
  )
}
