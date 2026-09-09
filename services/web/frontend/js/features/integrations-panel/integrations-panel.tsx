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
    // Custom build: the Git Provider card is PAT-based (per-user token for
    // GitHub/GitLab/Gitea/Forgejo) and needs no server-side OAuth, so it is
    // always available — no longer gated on githubSyncEnabled (which only
    // reflects GitHub OAuth credentials being configured).
    (getMeta('ol-ExposedSettings').zoteroEnabled || !path.includes('zotero')) &&
    (getMeta('ol-ExposedSettings').webdavEnabled || !path.includes('webdav'))
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
