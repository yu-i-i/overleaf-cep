import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { debugConsole } from '@/utils/debugging'
import { getJSON, postJSON, deleteJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'

type McpToken = {
  id: string
  partial: string
  purpose: string
  createdAt: string
  expiresAt: string
  lastUsedAt?: string
}

type CreatedMcpToken = {
  id: string
  token: string
  purpose: string
  createdAt: string
  expiresAt: string
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export const PersonalMcpTokensWidget = function PersonalMcpTokensWidget() {
  const { t } = useTranslation()

  const [tokens, setTokens] = useState<McpToken[]>([])
  const [purpose, setPurpose] = useState('')
  const [secretToken, setSecretToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { runAsync, isLoading } = useAsync()

  const loadTokens = useCallback(() => {
    runAsync(getJSON<{ tokens: McpToken[] }>('/personal-mcp/tokens'))
      .then((data) => setTokens(data.tokens))
      .catch((err) => debugConsole.error('personal-mcp: load failed', err))
  }, [runAsync])

  useEffect(() => {
    loadTokens()
  }, [loadTokens])

  const handleCreateToken = useCallback(() => {
    setError(null)
    runAsync(
      postJSON<CreatedMcpToken>('/personal-mcp/tokens', {
        body: { purpose: purpose.trim() },
      })
    )
      .then((data) => {
        const { token, ...rest } = data
        setTokens((prev) => [{ ...rest, partial: token.substring(0, 12) }, ...prev])
        setSecretToken(token)
        setPurpose('')
      })
      .catch(() => {
        setError(
          t(
            'could_not_create_token',
            'The token could not be created. Please try again.'
          )
        )
      })
  }, [purpose, runAsync, t])

  const handleDeleteToken = useCallback(
    (id: string) => {
      setError(null)
      runAsync(deleteJSON(`/personal-mcp/tokens/${id}`))
        .then(() => setTokens((prev) => prev.filter((tok) => tok.id !== id)))
        .catch(() => setError(t('could_not_delete_token', 'The token could not be deleted.')))
    },
    [runAsync, t]
  )

  return (
    <div style={{ padding: 'var(--spacing-05)' }}>
      <div>
        <p className="small">{t('personal_mcp_info')}</p>

        {error ? <Notification type="error" content={error} /> : null}

        {secretToken ? (
          <div className="well well-sm">
            <p className="small">
              <strong>{t('personal_mcp_new_token_warning')}</strong>
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {secretToken}
            </pre>
            <p className="small">
              {t('personal_mcp_endpoint_info', { url: '/mcp' })}
            </p>
          </div>
        ) : null}

        <h4 className="ui-heading">{t('user_personal_access_tokens')}</h4>
        {tokens.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t('token_prefix', 'Token')}</th>
                <th>{t('personal_mcp_token_purpose')}</th>
                <th>{t('personal_mcp_created')}</th>
                <th>{t('personal_mcp_expires')}</th>
                <th>{t('personal_mcp_last_used')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td>
                    <code>{token.partial}…</code>
                  </td>
                  <td>{token.purpose}</td>
                  <td className="small">{formatDateTime(token.createdAt)}</td>
                  <td className="small">{formatDateTime(token.expiresAt)}</td>
                  <td className="small">{formatDateTime(token.lastUsedAt)}</td>
                  <td>
                    <OLButton
                      variant="danger"
                      disabled={isLoading}
                      onClick={() => handleDeleteToken(token.id)}
                    >
                      {t('delete_token')}
                    </OLButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small">{t('personal_mcp_no_tokens')}</p>
        )}

        <div className="d-flex gap-2 mt-2">
          <input
            type="text"
            className="form-control"
            placeholder={t('personal_mcp_token_purpose')}
            value={purpose}
            maxLength={200}
            onChange={(e) => setPurpose(e.target.value)}
            disabled={isLoading}
          />
          <OLButton disabled={isLoading} onClick={handleCreateToken}>
            {t('generate_token')}
          </OLButton>
        </div>
      </div>
    </div>
  )
}

export default PersonalMcpTokensWidget
