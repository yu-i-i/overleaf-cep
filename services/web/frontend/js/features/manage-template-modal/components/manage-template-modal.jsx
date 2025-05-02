import React, { memo, useCallback, useState } from 'react'
import PropTypes from 'prop-types'
import OLModal from '@/features/ui/components/ol/ol-modal'
import ManageTemplateModalContent from './manage-template-modal-content'

function ManageTemplateModal({
  show,
  handleHide,
  handleAfterPublished,
  projectId,
  projectName,
}) {
  const [inFlight, setInFlight] = useState(false)

  const onHide = useCallback(() => {
    if (!inFlight) {
      handleHide()
    }
  }, [handleHide, inFlight])

  return (
    <OLModal
      animation
      show={show}
      onHide={onHide}
      id="publish-template-modal"
      // backdrop="static" will disable closing the modal by clicking
      // outside of the modal element
      backdrop='static'
    >
      <ManageTemplateModalContent
        handleHide={onHide}
        inFlight={inFlight}
        setInFlight={setInFlight}
        handleAfterPublished={handleAfterPublished}
        projectId={projectId}
        projectName={projectName}
      />
    </OLModal>
  )
}

ManageTemplateModal.propTypes = {
  show: PropTypes.bool.isRequired,
  handleHide: PropTypes.func.isRequired,
  handleAfterPublished: PropTypes.func.isRequired,
  projectId: PropTypes.string,
  projectName: PropTypes.string,
}

export default memo(ManageTemplateModal)
