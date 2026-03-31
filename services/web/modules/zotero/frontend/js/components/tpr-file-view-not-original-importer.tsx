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
  const { t } = useTranslation()
  const provider = file.linkedFileData?.provider

  if (provider !== 'zotero') {
    return null
  }

  // For now, this is a placeholder. In full implementation, you'd compare
  // file.linkedFileData.importedByUserId with the current user's ID.
  // Since we don't store the importer ID in the basic integration, we skip this check.
  return null
}
