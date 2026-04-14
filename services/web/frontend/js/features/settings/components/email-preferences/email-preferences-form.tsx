import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON, getUserFacingMessage } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import ToggleSetting from '@/features/settings/components/toggle-setting'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import getMeta from '@/utils/meta'

function EmailPreferencesForm() {
  const { t } = useTranslation()
  const initialNotificationPreferences = getMeta('ol-userNotificationPreferences')
  const [notificationPreferences, setNotificationPreferences] = useState(
    initialNotificationPreferences ?? {
      notificationEmailsEnabled: true,
      projectCommentReplyEmails: true,
      projectInviteEmails: true,
    }
  )
  const {
    isLoading,
    isSuccess,
    isError,
    error,
    runAsync,
  } = useAsync()
  const {
    isLoading: isSendingTestEmail,
    isSuccess: isSendTestEmailSuccess,
    isError: isSendTestEmailError,
    error: sendTestEmailError,
    data: sendTestEmailResult,
    runAsync: runAsyncTestEmail,
  } = useAsync()

  const updateNotificationPreferences = useCallback(
    newPreferences => {
      return postJSON('/user/notification-email-preferences', {
        body: newPreferences,
      }).then(response => {
        setNotificationPreferences(response)
        return response
      })
    },
    []
  )

  const handleToggleNotificationEmails = () => {
    const updatedPreferences = {
      ...notificationPreferences,
      notificationEmailsEnabled: !notificationPreferences.notificationEmailsEnabled,
    }
    runAsync(updateNotificationPreferences(updatedPreferences)).catch(
      () => {}
    )
  }

  const handleToggleCommentReplyEmails = () => {
    const updatedPreferences = {
      ...notificationPreferences,
      projectCommentReplyEmails: !notificationPreferences.projectCommentReplyEmails,
    }
    runAsync(updateNotificationPreferences(updatedPreferences)).catch(
      () => {}
    )
  }

  const handleToggleProjectInviteEmails = () => {
    const updatedPreferences = {
      ...notificationPreferences,
      projectInviteEmails: !notificationPreferences.projectInviteEmails,
    }
    runAsync(updateNotificationPreferences(updatedPreferences)).catch(
      () => {}
    )
  }

  const handleSendTestEmail = () => {
    runAsyncTestEmail(postJSON('/user/send-test-email')).catch(() => {})
  }

  return (
    <>
      {isError && (
        <OLNotification
          type="error"
          content={getUserFacingMessage(error)}
          className="mb-3"
        />
      )}
      {isSendTestEmailError && (
        <OLNotification
          type="error"
          content={getUserFacingMessage(sendTestEmailError)}
          className="mb-3"
        />
      )}
      {isSuccess && (
        <OLNotification
          type="success"
          content={t('thanks_settings_updated')}
          className="mb-3"
        />
      )}
      {isSendTestEmailSuccess && sendTestEmailResult?.message && (
        <OLNotification
          type="success"
          content={sendTestEmailResult.message}
          className="mb-3"
        />
      )}

      <section className="mb-4">
        <div className="text-end mb-3">
          <OLButton
            variant="primary"
            onClick={handleSendTestEmail}
            disabled={isLoading || isSendingTestEmail}
            isLoading={isSendingTestEmail}
            loadingLabel={`${t('sending')}…`}
          >
            {t('send_test_email')}
          </OLButton>
        </div>

        <ToggleSetting
          id="notificationEmailEnabled"
          label={t('notification_email_delivery')}
          description={t('notification_email_delivery_description')}
          checked={notificationPreferences.notificationEmailsEnabled}
          onChange={handleToggleNotificationEmails}
          disabled={isLoading}
        />

        <ToggleSetting
          id="projectCommentReplyEmails"
          label={t('notification_email_project_comment_reply')}
          description={t('notification_email_project_comment_reply_description')}
          checked={notificationPreferences.projectCommentReplyEmails}
          onChange={handleToggleCommentReplyEmails}
          disabled={
            isLoading || !notificationPreferences.notificationEmailsEnabled
          }
        />

        <ToggleSetting
          id="projectInviteEmails"
          label={t('notification_email_project_invite')}
          description={t('notification_email_project_invite_description')}
          checked={notificationPreferences.projectInviteEmails}
          onChange={handleToggleProjectInviteEmails}
          disabled={
            isLoading || !notificationPreferences.notificationEmailsEnabled
          }
        />
      </section>
    </>
  )
}

export default EmailPreferencesForm
