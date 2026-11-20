import { useEffect } from 'react'
import * as eventTracking from '@/infrastructure/event-tracking'
import { ProjectListDsNav } from './project-list-ds-nav'
import { DsNavStyleProvider } from '@/features/project-list/components/use-is-ds-nav'
import useThemedPage from '@/shared/hooks/use-themed-page'

export default function ProjectListRoot() {
  useThemedPage()

  useEffect(() => {
    eventTracking.sendMB('loads_v2_dash', {})
  }, [])

  return (
    <DsNavStyleProvider>
      <ProjectListDsNav />
    </DsNavStyleProvider>
  )
}
