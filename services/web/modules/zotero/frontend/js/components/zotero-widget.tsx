import { useTranslation } from 'react-i18next'
import { useCallback, useState } from 'react'
import { postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import OLFormControl from '@/shared/components/ol/ol-form-control'

/**
 * Zotero account linking widget for the Account Settings page.
 * Instead of OAuth, users paste their Zotero API key directly.
 * Create one at https://www.zotero.org/settings/keys with:
 *   - "Allow library access"
 *   - "Allow read access to all groups" (for group library imports)
 *
 * Registered via overleafModuleImports.referenceLinkingWidgets.
 */
export default function ZoteroWidget() {
  const { t } = useTranslation()
  const user = getMeta('ol-user')
  const refProviders = user?.refProviders || {}
  const isLinked = Boolean(refProviders.zotero)
  const [apiKey, setApiKey] = useState('')
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleLink = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!apiKey.trim()) return
      setLinking(true)
      setError('')
      setSuccess('')
      try {
        await postJSON('/zotero/link', { body: { apiKey: apiKey.trim() } })
        setSuccess('Zotero account linked successfully.')
        setApiKey('')
        // Reload to reflect the new linked state
        setTimeout(() => window.location.reload(), 1000)
      } catch (err: any) {
        const msg =
          err?.data?.error === 'invalid_api_key'
            ? 'Invalid API key. Please check your key and try again.'
            : t('generic_something_went_wrong')
        setError(msg)
        setLinking(false)
      }
    },
    [apiKey, t]
  )

  const handleUnlink = useCallback(async () => {
    setUnlinking(true)
    setError('')
    setSuccess('')
    try {
      await postJSON('/zotero/unlink')
      window.location.reload()
    } catch (err) {
      setError(t('generic_something_went_wrong'))
      setUnlinking(false)
    }
  }, [t])

  return (
    <div className="settings-widget-container">
      <div>
        <ZoteroLogo />
      </div>
      <div className="description-container">
        <div className="title-row">
          <h4>{t('zotero')}</h4>
        </div>
        <p className="small">
          {t('zotero_sync_description', {
            appName:
              getMeta('ol-ExposedSettings')?.appName || 'Overleaf',
          })}
        </p>
        {error && <OLNotification type="error" content={error} />}
        {success && <OLNotification type="success" content={success} />}
        {!isLinked && (
          <form onSubmit={handleLink}>
            <p className="small text-muted">
              Create an API key at{' '}
              <a
                href="https://www.zotero.org/settings/keys/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                zotero.org/settings/keys
              </a>{' '}
              with <strong>Allow library access</strong> and{' '}
              <strong>Allow read access to all groups</strong> enabled.
            </p>
            <div className="form-group">
              <OLFormControl
                type="text"
                placeholder="Paste your Zotero API key"
                value={apiKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setApiKey(e.target.value)
                }
                disabled={linking}
                autoComplete="off"
              />
            </div>
            <OLButton
              variant="primary"
              type="submit"
              disabled={linking || !apiKey.trim()}
              isLoading={linking}
            >
              {t('link_to_zotero')}
            </OLButton>
          </form>
        )}
      </div>
      <div>
        {isLinked && (
          <OLButton
            variant="danger-ghost"
            onClick={handleUnlink}
            disabled={unlinking}
            isLoading={unlinking}
          >
            {t('unlink')}
          </OLButton>
        )}
      </div>
    </div>
  )
}

function ZoteroLogo() {
  return (
    <img
      src="/img/third-party-icons/zotero.svg"
      alt="Zotero"
      style={{ width: 40, height: 40 }}
    />
  )
}
