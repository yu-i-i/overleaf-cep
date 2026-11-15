import React from 'react'
import { useGitSync } from '../git-sync-provider'
import { OLDropdownItem } from '@/shared/components/ol/ol-dropdown-menu'

export default function ImportFromGitMenu({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  const { t } = useGitSync()
  return (
    <OLDropdownItem onClick={onClick}>
      {t('import_from_github')}
    </OLDropdownItem>
  )
}
