import { useCallback, useEffect, useState } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import type { NotificationPreferencesSchema } from '../../../../../modules/notifications/app/src/types.js'

export type NotificationLevel = 'all' | 'replies' | 'off'

/**
 * Map UI notification level to backend preferences
 */
function levelToPreferences(
  level: NotificationLevel,
  preferences: NotificationPreferencesSchema
): NotificationPreferencesSchema {
  const defaults = {
    trackedChangesOnOwnProject: false,
    trackedChangesOnInvitedProject: false,
    commentOnOwnProject: false,
    commentOnInvitedProject: false,
    repliesOnOwnProject: false,
    repliesOnInvitedProject: false,
    repliesOnAuthoredThread: false,
    repliesOnParticipatingThread: false,
  }

  switch (level) {
    case 'all':
      return {
        ...preferences,
        ...defaults,
        trackedChangesOnOwnProject: true,
        trackedChangesOnInvitedProject: true,
        commentOnOwnProject: true,
        commentOnInvitedProject: true,
        repliesOnOwnProject: true,
        repliesOnInvitedProject: true,
        repliesOnAuthoredThread: true,
        repliesOnParticipatingThread: true,
      }
    case 'replies':
      return {
        ...preferences,
        ...defaults,
        repliesOnAuthoredThread: true,
        repliesOnParticipatingThread: true,
      }
    case 'off':
      return { ...preferences, ...defaults }
  }
}

/**
 * Map backend preferences to UI notification level
 */
function preferencesToLevel(
  preferences: NotificationPreferencesSchema
): NotificationLevel {
  // If all notifications are off
  if (
    !preferences.commentOnOwnProject &&
    !preferences.commentOnInvitedProject &&
    !preferences.repliesOnOwnProject &&
    !preferences.repliesOnInvitedProject &&
    !preferences.repliesOnAuthoredThread &&
    !preferences.repliesOnParticipatingThread
  ) {
    return 'off'
  }

  // If only reply-related notifications are on
  if (
    !preferences.commentOnOwnProject &&
    !preferences.commentOnInvitedProject &&
    (preferences.repliesOnAuthoredThread ||
      preferences.repliesOnParticipatingThread)
  ) {
    return 'replies'
  }

  // Default to 'all' for any other combination
  return 'all'
}

export function useProjectNotificationPreferences() {
  const { projectId } = useProjectContext()
  const [preferences, setPreferences] =
    useState<NotificationPreferencesSchema>({
      trackedChangesOnOwnProject: true,
      trackedChangesOnInvitedProject: true,
      commentOnOwnProject: true,
      commentOnInvitedProject: true,
      repliesOnOwnProject: true,
      repliesOnInvitedProject: true,
      repliesOnAuthoredThread: true,
      repliesOnParticipatingThread: true,
      sendCommentReplyEmails: true,
    })
  const [notificationLevel, setNotificationLevel] =
    useState<NotificationLevel>('all')
  const [isLoading, setIsLoading] = useState(true)

  // Load preferences on mount
  useEffect(() => {
    getJSON<NotificationPreferencesSchema>(
      `/notifications/preferences/project/${projectId}`
    )
      .then(prefs => {
        setPreferences(prefs)
        setNotificationLevel(preferencesToLevel(prefs))
      })
      .catch(debugConsole.error)
      .finally(() => setIsLoading(false))
  }, [projectId])

  const savePreferences = useCallback(
    (newPreferences: NotificationPreferencesSchema) => {
      setPreferences(newPreferences)
      setNotificationLevel(preferencesToLevel(newPreferences))
      postJSON(`/notifications/preferences/project/${projectId}`, {
        body: newPreferences,
      }).catch(debugConsole.error)
    },
    [projectId]
  )

  const setLevel = useCallback(
    (level: NotificationLevel) => {
      savePreferences(levelToPreferences(level, preferences))
    },
    [preferences, savePreferences]
  )

  const setSendCommentReplyEmails = useCallback(
    (sendCommentReplyEmails: boolean) => {
      savePreferences({
        ...preferences,
        sendCommentReplyEmails,
      })
    },
    [preferences, savePreferences]
  )

  return {
    notificationLevel,
    setNotificationLevel: setLevel,
    sendCommentReplyEmails: preferences.sendCommentReplyEmails,
    setSendCommentReplyEmails,
    isLoading,
  }
}
