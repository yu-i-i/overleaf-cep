import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UsersActionModal from './users-action-modal'
import UsersList from './users-list'
import Notification from '@/shared/components/notification'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'

type DeleteUserModalProps = Pick<
  React.ComponentProps<typeof UsersActionModal>,
  'users' | 'actionHandler' | 'showModal' | 'handleCloseModal'
>

function DeleteUserModal({
  users,
  actionHandler,
  showModal,
  handleCloseModal,
}: DeleteUserModalProps) {
  const { t } = useTranslation()
  const [usersToDisplay, setUsersToDisplay] = useState<typeof users>(
    []
  )

  useEffect(() => {
    if (showModal) {
      setUsersToDisplay(displayUsers => {
        return displayUsers.length ? displayUsers : users
      })
    } else {
      setUsersToDisplay([])
    }
  }, [showModal, users])

  const [sendEmail, setSendEmail] = useState<boolean>(false)

  useEffect(() => {
    if (showModal) {
      setSendEmail(false)
    }
  }, [showModal])

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { checked } = e.currentTarget
    setSendEmail(checked)
  }

  return (
    <UsersActionModal
      action="delete"
      actionHandler={actionHandler}
      title={t('delete_accounts')}
      showModal={showModal}
      handleCloseModal={handleCloseModal}
      users={users}
      options={{ sendEmail }}
    >
      <p>{t('about_to_delete_accounts')}</p>
      <UsersList users={users} usersToDisplay={usersToDisplay} />
      <Notification
        content={t('this_action_can_be_undone_within_limited_period')}
        type="warning"
      />
      <OLFormGroup controlId="send-email-checkbox"  className="mt-4 d-flex justify-content-end">
        <OLFormCheckbox
          autoComplete="off"
          onChange={handleCheckboxChange}
          name="sendEmail"
          label="Notify users about account deletion"
          checked={sendEmail}
          aria-label={"Notify users about account deletion"}
        />
      </OLFormGroup>
    </UsersActionModal>
  )
}

export default DeleteUserModal
