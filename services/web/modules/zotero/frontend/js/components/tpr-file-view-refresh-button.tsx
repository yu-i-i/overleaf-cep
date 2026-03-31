import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import type { BinaryFile } from '@/features/file-view/types/binary-file'

type TPRFileViewRefreshButtonProps = {
  file: BinaryFile
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
  const provider = (file.linkedFileData as Record<string, unknown>)?.provider

  if (provider !== 'zotero') {
    // Not a Zotero file — render default button
    return (
      <OLButton
        variant="primary"
        onClick={() => refreshFile(null)}
        disabled={refreshing}
        isLoading={refreshing}
        loadingLabel={t('refreshing')}
      >
        {t('refresh')}
      </OLButton>
    )
  }

  return (
    <OLButton
      variant="primary"
      onClick={() => refreshFile(true)}
      disabled={refreshing}
      isLoading={refreshing}
      loadingLabel={t('refreshing')}
    >
      {t('refresh')}
    </OLButton>
  )
}
