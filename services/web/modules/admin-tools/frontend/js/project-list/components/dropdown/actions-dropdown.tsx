import { useTranslation } from 'react-i18next'
import {
  OLDropdown,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import DownloadProjectButton from '../table/cells/action-buttons/download-project-button'
import TrashProjectButton from '../table/cells/action-buttons/trash-project-button'
import UntrashProjectButton from '../table/cells/action-buttons/untrash-project-button'
import DeleteProjectButton from '../table/cells/action-buttons/delete-project-button'
import RestoreProjectButton from '../table/cells/action-buttons/restore-project-button'
import PurgeProjectButton from '../table/cells/action-buttons/purge-project-button'
import TransferProjectButton from '../table/cells/action-buttons/transfer-project-button'
import { Project } from '../../../../../types/project/api'
import MaterialIcon from '@/shared/components/material-icon'
import OLSpinner from '@/shared/components/ol/ol-spinner'

type ActionsDropdownProps = {
  project: Project
}

function ActionsDropdown({ project }: ActionsDropdownProps) {
  const { t } = useTranslation()

  return (
    <OLDropdown align="end">
      <OLDropdownToggle
        id={`project-actions-dropdown-toggle-btn-${project.id}`}
        bsPrefix="dropdown-table-button-toggle"
      >
        <MaterialIcon type="more_vert" accessibilityLabel={t('actions')} />
      </OLDropdownToggle>
      <OLDropdownMenu flip={false}>
        <DownloadProjectButton project={project}>
          {(text, downloadProject) => (
            <li role="none">
              <OLDropdownItem
                as="button"
                tabIndex={-1}
                onClick={downloadProject}
                leadingIcon="download"
              >
                {text}
              </OLDropdownItem>
            </li>
          )}
        </DownloadProjectButton>
        <TransferProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <OLDropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="swap_horiz"
              >
                {text}
              </OLDropdownItem>
            </li>
          )}
        </TransferProjectButton>
        <TrashProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <OLDropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="delete"
              >
                {text}
              </OLDropdownItem>
            </li>
          )}
        </TrashProjectButton>
        <UntrashProjectButton project={project}>
          {(text, untrashProject) => (
            <li role="none">
              <OLDropdownItem
                as="button"
                tabIndex={-1}
                onClick={untrashProject}
                leadingIcon="restore_page"
              >
                {text}
              </OLDropdownItem>
            </li>
          )}
        </UntrashProjectButton>
        <DeleteProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <OLDropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="block"
              >
                {text}
              </OLDropdownItem>
            </li>
          )}
        </DeleteProjectButton>
        <RestoreProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <OLDropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="restore"
              >
                {text}
              </OLDropdownItem>
            </li>
          )}
        </RestoreProjectButton>
        <PurgeProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <OLDropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="delete_forever"
              >
                {text}
              </OLDropdownItem>
            </li>
          )}
        </PurgeProjectButton>
      </OLDropdownMenu>
    </OLDropdown>
  )
}

export default ActionsDropdown
