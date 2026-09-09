import React from 'react'
import { useTranslation } from 'react-i18next'

interface ImportFromWebdavMenuProps {
  onImportClick: () => void
}

export default function ImportFromWebdavMenu({ onImportClick }: ImportFromWebdavMenuProps) {
  const { t } = useTranslation()

  return (
    <li className="dropdown-submenu">
      <button type="button" className="dropdown-item" onClick={onImportClick}>
        {t('webdav.import_from_webdav')}
      </button>
    </li>
  )
}
