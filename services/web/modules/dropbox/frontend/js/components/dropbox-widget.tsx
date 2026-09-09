import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import OLButton from '@/shared/components/ol/ol-button'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

const DropboxWidget = () => {
  const { t } = useTranslation()
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    getJSON('/user/dropbox/status')
      .then((status: { connected: boolean }) => {
        setConnected(status.connected)
      })
      .catch((err: any) => {
        debugConsole.error(err?.message || err)
        setError(err?.data?.error || err?.message || t('generic_something_went_wrong'))
      })
      .finally(() => setLoading(false))
  }, [t])

  const connect = async () => {
    setWorking(true)
    setError(undefined)
    window.location.assign('/user/dropbox/oauth2')
  }

  const disconnect = async () => {
    setWorking(true)
    try {
      await postJSON('/user/dropbox/disconnect')
      setConnected(false)
    } catch (err: any) {
      setError(err?.data?.error || err?.message || t('generic_something_went_wrong'))
    } finally {
      setWorking(false)
    }
  }

  if (loading) return <p className="small">{t('loading')}...</p>

  return (
    <div className="settings-widget-container">
      <div className="d-none d-md-block" aria-hidden="true" />
      <div className="description-container">
        <h4>Dropbox</h4>
        {error && <p className="text-danger small">{error}</p>}
        {connected ? (
          <>
            <p className="small">Connected to Dropbox.</p>
            <OLButton variant="danger-ghost" onClick={disconnect} disabled={working}>
              Disconnect
            </OLButton>
          </>
        ) : (
          <>
            <OLButton variant="secondary" onClick={connect} disabled={working}>
              Connect Dropbox
            </OLButton>
          </>
        )}
      </div>
    </div>
  )
}

export default DropboxWidget
