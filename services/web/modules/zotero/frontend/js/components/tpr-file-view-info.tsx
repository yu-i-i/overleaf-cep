import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { formatTime, relativeDate } from '@/features/utils/format-date'
import { LinkedFileIcon } from '@/features/file-view/components/file-view-icons'
import { hasProvider } from '@/features/file-view/types/binary-file'
import type { LinkedFile, LinkedFileData } from '@/features/file-view/types/binary-file'

type TPRFileViewInfoProps = {
  file: LinkedFile<keyof LinkedFileData>
}

/**
 * Shows "Imported from Zotero at <date>" in the file view header
 * when viewing a Zotero-linked .bib file.
 * Registered via overleafModuleImports.tprFileViewInfo.
 */
export function TPRFileViewInfo({ file }: TPRFileViewInfoProps) {
  const { t } = useTranslation()

  if (!hasProvider(file, 'zotero')) return null

  const importedAt = (file.linkedFileData as any)?.importedAt || file.created
  const formattedDate = formatTime(importedAt)
  const relative = relativeDate(importedAt)

  const importedByUserId = (file.linkedFileData as any)?.importedByUserId
  const importedByName = (file.linkedFileData as any)?.importedByName || 'Unknown'

  return (
    <p>
      <LinkedFileIcon />
      &nbsp;
      {(importedByUserId === getMeta('ol-user_id')) ? (
        t('imported_from_zotero_at_date', {
          formattedDate,
          relativeDate: relative,
        })
      ) : (
        t('imported_from_zotero_at_date_by', {
          formattedDate,
          relativeDate: relative,
          importedByName,
        })
      )}
    </p>
  )
}
