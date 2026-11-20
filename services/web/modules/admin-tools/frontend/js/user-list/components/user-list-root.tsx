import { useEffect } from 'react'
import * as eventTracking from '@/infrastructure/event-tracking'
import { DsNavStyleProvider } from '@/features/project-list/components/use-is-ds-nav'
import useThemedPage from '@/shared/hooks/use-themed-page'
import { UserListDsNav } from './user-list-ds-nav'

export default function UserListRoot() {
  useThemedPage()

  useEffect(() => {
    eventTracking.sendMB('loads_v2_dash', {})
  }, [])

  return (
    <DsNavStyleProvider>
      <UserListDsNav />
    </DsNavStyleProvider>
  )
}
