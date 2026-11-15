import { ElementType } from 'react'
import importOverleafModules from '../../../macros/import-overleaf-module.macro'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import getMeta from '../../utils/meta'

const exposedSettings = getMeta('ol-ExposedSettings')
const enabledModules = [
  ...(getMeta('ol-gitBridgeEnabled') ? ['git-bridge'] : []),
  ...(exposedSettings.githubSyncEnabled ? ['git-sync/github'] : []),
  ...(exposedSettings.gitlabSyncEnabled ? ['git-sync/gitlab'] : []),
  ...(exposedSettings.giteaSyncEnabled ? ['git-sync/gitea'] : []),
  ...(exposedSettings.zoteroEnabled ? ['zotero'] : []),
]

const integrationPanelComponents = (importOverleafModules(
  'integrationPanelComponents'
) as { import: { default: ElementType }; path: string }[])
  .filter(({ path }) =>  enabledModules.some(modulePath => path.includes(modulePath)))

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
