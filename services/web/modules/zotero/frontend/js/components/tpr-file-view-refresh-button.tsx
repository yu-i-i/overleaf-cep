import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import type { LinkedFile, LinkedFileData } from '@/features/file-view/types/binary-file'
import { hasProvider } from '@/features/file-view/types/binary-file'

type TPRFileViewRefreshButtonProps = {
  file: LinkedFile<keyof LinkedFileData>
  refreshFile: (isTPR: boolean | null) => void
  refreshing: boolean
}

/**
 * Zotero-specific refresh button for the file view.
 * Tells the system this is a TPR file so references are re-indexed.
 * Registered via overleafModuleImports.tprFileViewRefreshButton.
 */
export function TPRFileViewRefreshButton({
  file,
  refreshFile,
  refreshing,
}: TPRFileViewRefreshButtonProps) {
  const { t } = useTranslation()
  const importedByUserId = (file.linkedFileData as any)?.importedByUserId
  const zoteroIsProvider = hasProvider(file, 'zotero')
  const disabled = (zoteroIsProvider && !importedByUserId) ? true : false

  return (
    <OLButton
      variant="primary"
      onClick={() => refreshFile(zoteroIsProvider ? true : null)}
      disabled={refreshing || disabled}
      isLoading={refreshing}
      loadingLabel={t('refreshing')}
    >
      {t('refresh')}
    </OLButton>
  )
}
