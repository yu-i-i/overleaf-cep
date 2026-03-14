import { OLModal } from '@/shared/components/ol/ol-modal'
import GitModalContent from './git-modal-content'

type Props = {
  show: boolean
  projectId: string
  handleHide: () => void
}

export default function GitModalWrapper({
  show,
  projectId,
  handleHide,
}: Props) {
  return (
    <OLModal
      show={show}
      onHide={handleHide}
      id="git-sync-modal"
      backdrop="static"
      size="lg"
    >
      <GitModalContent
        projectId={projectId}
        handleHide={handleHide}
      />
    </OLModal>
  )
}
