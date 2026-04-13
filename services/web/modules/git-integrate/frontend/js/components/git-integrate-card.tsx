/**
 * git-integrate: Integration panel card
 *
 * Rendered inside the integrations rail panel (right side of the editor) via
 * the `integrationPanelComponents` module import macro.
 *
 * Follows the same pattern as
 * services/web/modules/git-bridge/frontend/js/card/components/git-integration-card.tsx
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import IntegrationCard from '@/features/integrations-panel/integration-card.tsx'
import GitIntegrateModal from './git-integrate-modal'
import GitIntegrateIcon from './git-integrate-icon'

export default function GitIntegrateCard() {
    const { t } = useTranslation()
    const { project } = useProjectContext()
    const [show, setShow] = useState(false)

    const projectId = project?._id
    if (!projectId) return null

    return (
        <>
            <IntegrationCard
                title={t('git_integrate_card_title', 'Git Sync')}
                description={t(
                    'git_integrate_card_description',
                    'Push this project to GitHub, GitLab, Gitea, or Forgejo.'
                )}
                icon={<GitIntegrateIcon size={32} />}
                showPaywallBadge={false}
                onClick={() => setShow(true)}
            />

            <GitIntegrateModal
                show={show}
                projectId={projectId}
                handleHide={() => setShow(false)}
            />
        </>
    )
}
