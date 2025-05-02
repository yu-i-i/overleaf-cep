import React from 'react'
import PropTypes from 'prop-types'
import withErrorBoundary from '../../../infrastructure/error-boundary'
import { useProjectContext } from '../../../shared/context/project-context'
import ManageTemplateModal from './manage-template-modal'

const EditorManageTemplateModalWrapper = React.memo(
  function EditorManageTemplateModalWrapper({ show, handleHide, openTemplate }) {
    const {
      _id: projectId,
      name: projectName,
    } = useProjectContext()

    if (!projectName) {
      // wait for useProjectContext
      return null
    } else {
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
  }
)

EditorManageTemplateModalWrapper.propTypes = {
  show: PropTypes.bool.isRequired,
  handleHide: PropTypes.func.isRequired,
  openTemplate: PropTypes.func.isRequired,
}

export default withErrorBoundary(EditorManageTemplateModalWrapper)
