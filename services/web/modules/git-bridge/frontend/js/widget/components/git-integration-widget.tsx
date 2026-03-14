import { useState, useCallback, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { debugConsole } from '@/utils/debugging'
import { postJSON, getJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import GitLogoOrange from '@/shared/svgs/git-logo-orange'
import TokenTable from './token-table'
import ExposeTokenModal from './modals/expose-token-modal'
import { Token } from '../../../../types/api'

export default function GitIntegrationWidget() {
  const { t } = useTranslation()

  const [tokens, setTokens] = useState<Token[]>([])
  const [showExposeTokenModal, setShowExposeTokenModal] = useState(false)
  const [secretToken, setSecretToken] = useState<string | null>(null)

  const { runAsync, isLoading, isError, reset } = useAsync()

  useEffect(() => {
    runAsync(getJSON('/git-bridge/personal-access-tokens'))
      .then((data: Token[]) => setTokens(data))
      .catch(debugConsole.error)
  }, [runAsync])

  const handleCreateToken = useCallback(() => {
    runAsync(postJSON('/git-bridge/personal-access-tokens'))
      .then((data: Token & { accessToken: string }) => {
        const { accessToken, ...newToken } = data
        setTokens(prev => [...prev, newToken])
        setSecretToken(accessToken)
        setShowExposeTokenModal(true)
      })
      .catch((err) => {
        debugConsole.error(err)
        setTimeout(() => reset(), 5000)
      })
  }, [runAsync])

  const handleDeleteToken = useCallback((id: string) => {
    setTokens(prev => prev.filter(t => t._id !== id))
  }, [])

  const tokenCount = tokens.length

  return (
    <div className="settings-widget-container">

      <div className="linking-icon-fixed-position">
        <GitLogoOrange />
      </div>

      <div className="description-container">

        <div className="title-row">
          <h4>{t('git_integration')}</h4>
        </div>

        <p className="small">
          <Trans
            i18nKey="git_integration_info"
            components={[
              <a
                key="git-link"
                href="/learn/how-to/Git_Integration"
                target="_blank"
                rel="noreferrer noopener"
              />,
            ]}
          />
        </p>

        <h4 className="ui-heading">
          {t('your_git_access_tokens')}
        </h4>

        <p className="small">
          {t('your_git_access_info')}
        </p>

        <ul className="small">
          {tokenCount > 0 ? (
            <>
              <li>{t('your_git_access_info_bullet_1')}</li>
              <li>{t('your_git_access_info_bullet_2')}</li>
            </>
          ) : (
            <>
              <li>
                <Trans
                  i18nKey="your_git_access_info_bullet_3"
                  components={[<strong key="strong" />]}
                />
              </li>
              <li>{t('your_git_access_info_bullet_4')}</li>
              <li>{t('your_git_access_info_bullet_5')}</li>
            </>
          )}
        </ul>

        <TokenTable
          tokens={tokens}
          onCreateToken={handleCreateToken}
          onDeleteToken={handleDeleteToken}
        />

        {isError && (
          <div className="notification-list">
            <Notification
              type="error"
              content={t('something_went_wrong_server')}
            />
          </div>
        )}

      </div>

      {tokenCount === 0 && (
        <div>
          <OLButton
            variant="secondary"
            id="generate-token-button"
            onClick={handleCreateToken}
            disabled={isLoading || isError}
          >
            {t('generate_token')}
          </OLButton>
        </div>
      )}

      {showExposeTokenModal && secretToken && (
        <ExposeTokenModal
          secretToken={secretToken}
          handleHide={() => {
            setShowExposeTokenModal(false)
            setSecretToken(null)
          }}
        />
      )}
    </div>
  )
}
