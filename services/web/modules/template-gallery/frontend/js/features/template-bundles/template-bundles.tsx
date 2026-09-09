/**
 * R6 (2026-08-29): shared "template bundles" UI — used both on the
 * site-admin console (/admin/site → Templates) and, for users with the
 * template gallery admin role, on the /templates page.
 *
 * Features:
 *  - list of all templates with per-template "Download bundle"
 *    (GET /template/:id/bundle — template.json + source.zip + output.pdf)
 *  - import a bundle from file (POST /template/bundle/import)
 *  - import a bundle from URL  (POST /template/bundle/import-url —
 *    SSRF-guarded by the External URLs site policy)
 *  - rich feedback on rejection: the server returns a structured `issues`
 *    list (422) that is rendered item by item so the importer can fix
 *    the bundle (R6 item 5: "test the imported bundle carefully before
 *    adding ... give the user rich feedback such that they can fix it")
 *  - same-name conflict → 409 with confirm-to-override (existing flow)
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'

type TemplateRow = { id: string; name: string; version: string; category: string }
type Status =
  | { kind: 'ok' | 'error'; text: string }
  | { kind: 'issues'; issues: string[] }
  | null

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return window.btoa(binary)
}

function issuesFrom(err: unknown): string[] | null {
  const data = (err as { data?: { issues?: string[] } })?.data
  if (data && Array.isArray(data.issues) && data.issues.length > 0) {
    return data.issues
  }
  return null
}

export default function TemplateBundles({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refresh = () => {
    void getJSON<{ totalSize: number; templates: TemplateRow[] }>(
      '/api/templates/admin-list'
    )
      .then(d => setTemplates(d.templates || []))
      .catch(err => setLoadError(err?.data?.message || t('Could not load the template list')))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showFailure = (err: unknown) => {
    const issues = issuesFrom(err)
    if (issues) {
      setStatus({ kind: 'issues', issues })
      return
    }
    const e = err as {
      response?: { status?: number }
      data?: { message?: string; canOverride?: boolean }
      message?: string
    }
    const message = e?.data?.message || e?.message || t('Import failed')
    setStatus({ kind: 'error', text: message })
  }
  void showFailure

  const doImport = (b64: string, override: boolean) => {
    setBusy(true)
    setStatus(null)
    return postJSON('/template/bundle/import', { body: { data: b64, override } })
      .then(data => {
        const msg = data.created
          ? t('Bundle imported: template created', { name: data.name || '' })
          : t('Bundle imported: template replaced (v__version__)', { version: data.version })
        setStatus({ kind: 'ok', text: typeof msg === 'string' ? msg : String(msg) })
        refresh()
      })
      .catch(err => {
        if (err?.response?.status === 409 && err?.data?.canOverride) {
          // eslint-disable-next-line no-alert
          const yes = window.confirm(
            `${err.data.message}\n\n${t('Import over the existing template?')}`
          )
          if (yes) return doImport(b64, true)
          setStatus({ kind: 'error', text: err.data.message || t('Import failed') })
        } else {
          showFailure(err)
        }
      })
      .finally(() => setBusy(false))
  }

  const doImportUrl = (rawUrl: string, override: boolean) => {
    setBusy(true)
    setStatus(null)
    return postJSON('/template/bundle/import-url', { body: { url: rawUrl, override } })
      .then(data => {
        const msg = data.created
          ? t('Bundle imported: template created', { name: data.name || '' })
          : t('Bundle imported: template replaced (v__version__)', { version: data.version })
        setStatus({ kind: 'ok', text: typeof msg === 'string' ? msg : String(msg) })
        setUrl('')
        refresh()
      })
      .catch(err => {
        if (err?.response?.status === 409 && err?.data?.canOverride) {
          // eslint-disable-next-line no-alert
          const yes = window.confirm(
            `${err.data.message}\n\n${t('Import over the existing template?')}`
          )
          if (yes) return doImportUrl(rawUrl, true)
          setStatus({ kind: 'error', text: err.data.message || t('Import failed') })
        } else {
          showFailure(err)
        }
      })
      .finally(() => setBusy(false))
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setStatus({ kind: 'error', text: t('Bundle too large (max ~9 MB)') })
      return
    }
    void file
      .arrayBuffer()
      .then(buf => doImport(bufToBase64(buf), false))
      .catch(err => setStatus({ kind: 'error', text: String(err?.message || err) }))
  }

  return (
    <div className="ce-admin-card card mb-4" style={compact ? { marginTop: 12 } : undefined}>
      <div className="card-header">
        <strong>{t('Template bundles')}</strong>
      </div>
      <div className="card-body">
        <p className="text-muted">
          {t(
            'A bundle is a zip of template.json + source.zip + output.pdf. Download one to save/backup a template, or import one (from a file or a URL) to restore/re-publish it (same name = replace, unless you confirm an override).'
          )}
        </p>
        {loadError && (
          <Notification type="error" content={loadError} isDismissible onDismiss={() => setLoadError(null)} />
        )}
        <table className="table table-sm align-middle mt-2">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('category')}</th>
              <th>{t('version')}</th>
              <th className="text-end"> </th>
            </tr>
          </thead>
          <tbody>
            {(templates || []).map(tp => (
              <tr key={tp.id}>
                <td><a href={`/template/${tp.id}`}>{tp.name}</a></td>
                <td className="text-muted">{(tp.category || '').replace('/templates/', '')}</td>
                <td className="text-muted">{tp.version}</td>
                <td className="text-end" style={{ whiteSpace: 'nowrap' }}>
                {/* R12-7 (2026-08-31): the in-place edit view is GET /template/:id —
                    /template/:id/edit is POST-only (hence the 404). Same target as
                    the upstream EditTemplateButton. */}
                <OLButton variant="ghost" size="sm" as="a" href={`/template/${tp.id}`}>
                  {t('Edit')}
                </OLButton>
                <OLButton
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(t('Delete this template and its bundled assets? This cannot be undone.'))) {
                      return
                    }
                    setBusy(true)
                    setStatus(null)
                    const csrf = (document.querySelector('meta[name=ol-csrfToken]') || {}).content || ''
                    void fetch(`/template/${tp.id}/delete`, {
                      method: 'DELETE',
                      headers: { 'content-type': 'application/json', 'X-Csrf-Token': csrf },
                    })
                      .then(async r => {
                        if (!r.ok) {
                          const body = await r.json().catch(() => ({}))
                          throw new Error(body.message || `HTTP ${r.status}`)
                        }
                        setStatus({ kind: 'success', text: t('Template deleted', { name: tp.name }) })
                        refresh()
                      })
                      .catch(err => {
                        setStatus({ kind: 'error', text: err?.message || String(err) })
                        refresh()
                      })
                      .finally(() => setBusy(false))
                  }}
                >
                  {t('Delete')}
                </OLButton>
                <OLButton variant="ghost" size="sm" as="a" href={`/template/${tp.id}/bundle`}>
                  {t('Download bundle')}
                </OLButton>
              </td>
            </tr>
          ))}
          </tbody>
        </table>
        <div className="d-flex gap-2 align-items-center flex-wrap mt-2">
        <OLButton variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {t('Import bundle…')}
        </OLButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/zip,.zip"
          style={{ display: 'none' }}
          onChange={onFile}
          data-testid="bundle-import-file"
        />
        <OLButton
          variant="secondary"
          disabled={busy || url.trim() === ''}
          onClick={() => doImportUrl(url.trim(), false)}
          data-testid="bundle-import-url"
        >
          {t('Import from URL…')}
        </OLButton>
        <input
          type="url"
          className="form-control form-control-sm"
          style={{ flex: '1 1 260px', minWidth: '220px' }}
          placeholder={t('template_bundles_url_placeholder')}
          value={url}
          onChange={e => setUrl(e.target.value)}
          data-testid="bundle-import-url-input"
        />
        {busy && <span className="text-muted">{t('Importing…')}</span>}
        </div>
      {status && status.kind === 'issues' && (
        <div style={{ marginTop: '8px' }}>
          <Notification type="error" content={t('Bundle rejected — fix the following and try again:')} />
          <ul
            style={{
              margin: '8px 0 0 20px',
              padding: 0,
              fontSize: '13px',
              color: 'var(--text-error, #b00)',
            }}
          >
            {status.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {status && status.kind !== 'issues' && (
        <div style={{ marginTop: '8px' }}>
          <Notification
            type={status.kind === 'ok' ? 'success' : 'warning'}
            content={status.text}
            isDismissible
            onDismiss={() => setStatus(null)}
          />
        </div>
      )}
      </div>
    </div>
  )
}
