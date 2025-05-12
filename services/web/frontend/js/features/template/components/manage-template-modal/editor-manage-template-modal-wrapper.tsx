import React from 'react'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { useProjectContext } from '@/shared/context/project-context'
import ManageTemplateModal from './manage-template-modal'
import type { Template } from '../../../../../../types/template'

interface EditorManageTemplateModalWrapperProps {
  show: boolean
  handleHide: () => void
  openTemplate: (data: Template) => void
}

const EditorManageTemplateModalWrapper = React.memo(
  function EditorManageTemplateModalWrapper({ 
    show,
    handleHide,
    openTemplate,
  }: EditorManageTemplateModalWrapperProps) {
    const {
      _id: projectId,
      name: projectName,
    } = useProjectContext()

    if (!projectName) {
      // wait for useProjectContext
      return null
    }
    return (
      <ManageTemplateModal
        handleHide={handleHide}
        show={show}
        handleAfterPublished={openTemplate}
        projectId={projectId}
        projectName={projectName}
      />
    )
  }
)

export default withErrorBoundary(EditorManageTemplateModalWrapper)
