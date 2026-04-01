import { useTranslation } from 'react-i18next'
import type { BinaryFile } from '@/features/file-view/types/binary-file'
import OLNotification from '@/shared/components/ol/ol-notification'
import getMeta from '@/utils/meta'

type TPRFileViewNotOriginalImporterProps = {
  file: BinaryFile
}

/**
 * Shows a warning if the current user is not the original importer of this Zotero file.
 * Registered via overleafModuleImports.tprFileViewNotOriginalImporter.
 */
export function TPRFileViewNotOriginalImporter({
  file,
}: TPRFileViewNotOriginalImporterProps) {
  const provider = file.linkedFileData?.provider

  if (provider !== 'zotero') {
    return null
  }

  const currentUserId =
    (getMeta('ol-user') as any)?._id || (getMeta('ol-user_id') as string)
  const importedByUserId = (file.linkedFileData as any)?.importedByUserId

  if (provider !== 'zotero') {
    return null
  }

  if (!importedByUserId) {
    return (
      <OLNotification
        type="warning"
        content={
          'Original importer is unknown. Refresh is restricted to the original Zotero importer.'
        }
      />
    )
  }

  if (currentUserId && importedByUserId !== currentUserId) {
    return (
      <OLNotification
        type="warning"
        content={
          'This Zotero file was imported by another user. You cannot refresh it until the owner performs a refresh.'
        }
      />
    )
  }

  return null
}
