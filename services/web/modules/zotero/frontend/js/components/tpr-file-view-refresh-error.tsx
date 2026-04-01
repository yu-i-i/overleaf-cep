import { useTranslation } from 'react-i18next'
import OLNotification from '@/shared/components/ol/ol-notification'
import type { BinaryFile } from '@/features/file-view/types/binary-file'

type TPRFileViewRefreshErrorProps = {
  file: BinaryFile
  refreshError: string
}

/**
 * Zotero-specific error messages when refreshing a linked file fails.
 * Registered via overleafModuleImports.tprFileViewRefreshError.
 */
export function TPRFileViewRefreshError({
  file,
  refreshError,
}: TPRFileViewRefreshErrorProps) {
  const { t } = useTranslation()

  if (file.linkedFileData?.provider !== 'zotero') {
    // Not a Zotero file — fall back to default error display
    return (
      <div className="file-view-error">
        <OLNotification type="error" content={refreshError} />
      </div>
    )
  }

  let message = refreshError
  if (refreshError === 'forbidden' || refreshError?.includes('403')) {
    message = t('zotero_reference_loading_error_forbidden')
  } else if (
    refreshError === 'expired' ||
    refreshError?.includes('token expired')
  ) {
    message = t('zotero_reference_loading_error_expired')
  } else if (!message) {
    message = t('zotero_reference_loading_error')
  }

  return (
    <div className="file-view-error">
      <OLNotification type="error" content={message} />
    </div>
  )
}
