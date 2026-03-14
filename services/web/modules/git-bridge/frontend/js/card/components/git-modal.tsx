import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import getMeta from '@/utils/meta'
import GitFork from '@/shared/svgs/git-fork'
import { useProjectContext } from '@/shared/context/project-context'
import LeftMenuButton from '@/features/editor-left-menu/components/left-menu-button'
import GitModalWrapper from './git-modal-wrapper'

function GitSyncButton() {
  const { t } = useTranslation()
  const { project } = useProjectContext()
  const [show, setShow] = useState(false)

  const gitBridgeEnabled = getMeta('ol-gitBridgeEnabled')
  const projectId = project?._id

  if (!gitBridgeEnabled || !projectId) return null

  return (
    <>
      <LeftMenuButton
        variant="link"
        className="left-menu-button"
        onClick={() => setShow(true)}
        icon={<GitFork />}
      >
        {t('git')}
      </LeftMenuButton>

      <GitModalWrapper
        show={show}
        handleHide={() => setShow(false)}
        projectId={projectId}
      />
    </>
  )
}

export default GitSyncButton
