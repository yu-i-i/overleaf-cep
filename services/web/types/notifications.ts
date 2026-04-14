type GlobalNotificationPreferences = {
  muteAllNotifications: boolean
}

export type UserNotificationPreferences = {
  newsletter: boolean
  notificationEmailsEnabled: boolean
  projectCommentReplyEmails: boolean
  projectInviteEmails: boolean
} & GlobalNotificationPreferences
