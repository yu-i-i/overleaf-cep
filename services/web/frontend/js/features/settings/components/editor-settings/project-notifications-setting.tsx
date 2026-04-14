import { useTranslation } from 'react-i18next'
import RadioButtonSetting, { RadioOption } from '../radio-button-setting'
import ToggleSetting from '../toggle-setting'
import {
  NotificationLevel,
  useProjectNotificationPreferences,
} from '../../hooks/use-project-notification-preferences'

export default function ProjectNotificationsSetting() {
  const { t } = useTranslation()
  const {
    notificationLevel,
    setNotificationLevel,
    sendCommentReplyEmails,
    setSendCommentReplyEmails,
    isLoading,
  } = useProjectNotificationPreferences()

  const options: Array<RadioOption<NotificationLevel>> = [
    {
      value: 'all',
      label: t('all_project_activity'),
      description: t('all_project_activity_description'),
    },
    {
      value: 'replies',
      label: t('replies_to_your_activity_only'),
      description: t('replies_to_your_activity_only_description'),
    },
    {
      value: 'off',
      label: t('off'),
      description: t('no_project_notifications_description'),
    },
  ]

  return (
    <>
      <RadioButtonSetting
        id="projectNotifications"
        options={options}
        value={isLoading ? undefined : notificationLevel}
        onChange={setNotificationLevel}
      />
      <ToggleSetting
        id="projectNotificationEmails"
        label={t('project_notification_email_delivery')}
        description={t('project_notification_email_delivery_description')}
        checked={sendCommentReplyEmails}
        onChange={setSendCommentReplyEmails}
        disabled={isLoading}
      />
    </>
  )
}
