import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import UsersActionModal from './users-action-modal'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import { useRefWithAutoFocus } from '@/shared/hooks/use-ref-with-auto-focus'

type UpdateUserModalProps = Pick<
  React.ComponentProps<typeof UsersActionModal>,
  'users' | 'actionHandler' | 'showModal' | 'handleCloseModal'
>
const pickUserFields = ({ firstName, lastName, email, isAdmin, canManageTemplates }) => ({ firstName, lastName, email, isAdmin, canManageTemplates: Boolean(canManageTemplates) })

function UpdateUserModal({
  users,
  actionHandler,
  showModal,
  handleCloseModal,
}: UpdateUserModalProps) {
  const { t } = useTranslation()

  const { autoFocusedRef } = useRefWithAutoFocus<HTMLInputElement>()

  const [userData, setUserData] = useState(
    users.length === 1 ? pickUserFields(users[0]) : { firstName: '', lastName: '', email: '', isAdmin: false, canManageTemplates: false }
  )
  const isSelf = users[0] ? getMeta('ol-user_id') === users[0].id : false
  const allowUpdateDetails = users[0]?.allowUpdateDetails
  const allowUpdateIsAdmin = users[0]?.allowUpdateIsAdmin

  useEffect(() => {
    if (showModal && users.length === 1) {
      setUserData(pickUserFields(users[0]))
    }
  }, [showModal, users])

  // R9 item 7 (2026-08-29): the list rows can be stale (revoked/updated via
  // other modals), so re-fetch the CURRENT role state on open.
  useEffect(() => {
    if (!showModal || users.length !== 1) return
    const id = users[0].id
    let cancelled = false
    fetch(`/admin/user/${encodeURIComponent(id)}/info`, {
      credentials: 'same-origin',
      headers: { 'X-Csrf-Token': getMeta('ol-csrfToken') },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(info => {
        if (cancelled) return
        setUserData(d => ({
          ...d,
          canManageTemplates: Boolean(info?.canManageTemplates),
        }))
      })
      .catch(() => {
        // best effort — the modal keeps its initial value
      })
    return () => {
      cancelled = true
    }
  }, [showModal, users])

  if (users.length !== 1) return null

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.currentTarget
    setUserData(prev => ({ ...prev, [name]: value }))
  }

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.currentTarget
    setUserData(prev => ({ ...prev, [name]: checked }))
  }

  return (
    <UsersActionModal
      action="update"
      actionHandler={actionHandler}
      title={t('update_account_info')}
      showModal={showModal}
      handleCloseModal={handleCloseModal}
      users={users}
      options={{ userData }}
    >
      <OLFormGroup controlId="email-address">
        <OLFormLabel>{t('email_address')}</OLFormLabel>
        <OLFormControl
          ref={autoFocusedRef}
          maxLength="128"
          autoComplete="off"
          type="text"
          name="email"
          onChange={handleTextChange}
          value={userData.email}
        />
      </OLFormGroup>
      <OLFormGroup controlId="first-name">
        <OLFormLabel>{t('first_name')}</OLFormLabel>
        <OLFormControl
          maxLength="128"
          autoComplete="off"
          type="text"
          name="firstName"
          onChange={handleTextChange}
          value={userData.firstName}
          disabled={!allowUpdateDetails}
        />
      </OLFormGroup>
      <OLFormGroup controlId="last-name">
        <OLFormLabel>{t('last_name')}</OLFormLabel>
        <OLFormControl
          maxLength="128"
          autoComplete="off"
          type="text"
          name="lastName"
          onChange={handleTextChange}
          value={userData.lastName}
          disabled={!allowUpdateDetails}
        />
      </OLFormGroup>
      <OLRow>
        <OLCol xs={6}>
          <OLFormGroup controlId="is-admin-checkbox">
            <OLFormCheckbox
              autoComplete="off"
              onChange={handleCheckboxChange}
              name="isAdmin"
              label={t('set_admin_account')}
              checked={userData.isAdmin}
              disabled={isSelf || !allowUpdateIsAdmin}
            />
          </OLFormGroup>
        </OLCol>
      </OLRow>
      {/* R6 item 8 (2026-08-29): template gallery admin (scoped role —
          manages templates only, no other site admin powers). */}
      <OLRow>
        <OLCol xs={6}>
          <OLFormGroup controlId="is-template-admin-checkbox">
            <OLFormCheckbox
              autoComplete="off"
              onChange={handleCheckboxChange}
              name="canManageTemplates"
              label={t('template_gallery_admin')}
              checked={Boolean(userData.canManageTemplates)}
              disabled={Boolean(userData.isAdmin)}
              title={
                userData.isAdmin
                  ? t('template_gallery_admin_siteAdmin_locked')
                  : undefined
              }
            />
          </OLFormGroup>
        </OLCol>
      </OLRow>
    </UsersActionModal>
  )
}

export default UpdateUserModal
