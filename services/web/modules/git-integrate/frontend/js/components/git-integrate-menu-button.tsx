/**
 * git-integrate: Editor left-menu button (editorLeftMenuSync slot)
 *
 * Follows the same pattern as
 * services/web/modules/git-bridge/frontend/js/card/components/git-modal.tsx
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import LeftMenuButton from '@/features/editor-left-menu/components/left-menu-button'
import GitIntegrateModal from './git-integrate-modal'
import GitIntegrateIcon from './git-integrate-icon'

export default function GitIntegrateMenuButton() {
    const { t } = useTranslation()
    const { project } = useProjectContext()
    const [show, setShow] = useState(false)

    const projectId = project?._id
    if (!projectId) return null

    return (
        <>
            <LeftMenuButton
                variant="link"
                className="left-menu-button"
                onClick={() => setShow(true)}
                icon={<GitIntegrateIcon />}
            >
                {t('git_integrate_menu_label', 'Git Sync')}
            </LeftMenuButton>

            <GitIntegrateModal
                show={show}
                projectId={projectId}
                handleHide={() => setShow(false)}
            />
        </>
    )
}
