import type { ComponentProps } from 'react'
import Notification from '@/shared/components/notification'

// 既存の通知表示を使い、設定画面に必要な外側の余白だけを追加します。
export default function LLMNotification(
  props: ComponentProps<typeof Notification>
) {
  return (
    <div className="notification-list">
      <Notification {...props} />
    </div>
  )
}
