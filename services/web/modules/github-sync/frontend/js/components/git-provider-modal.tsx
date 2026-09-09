import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { postJSON } from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import GitProviderForm, { GitProviderFormState, GIT_PROVIDERS } from './git-provider-form'

type GitProviderModalProps = {
  show: boolean
  defaultProvider?: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  hideOnSuccess?: boolean
  onSuccess?: (server: { provider: string; url: string; username: string }) => void
  onHide: () => void
}

const initialForm = (provider = 'github'): GitProviderFormState => {
  const def = GIT_PROVIDERS.find(p => p.value === provider)
  return {
    provider,
    url: def ? def.defaultUrl : '',
    username: '',
    pat: '',
  }
}

/**
 * Modal for registering a git provider with a personal access token.
 * Shared between user settings and the project editor modals.
 */
const GitProviderModal = ({
  show,
  defaultProvider = 'github',
  title,
  confirmLabel,
  cancelLabel,
  hideOnSuccess = true,
  onSuccess,
  onHide,
}: GitProviderModalProps) => {
  const { t } = useTranslation()
  const [form, setForm] = useState<GitProviderFormState>(initialForm(defaultProvider))
  const [warning, setWarning] = useState('')
  const [checkFailed, setCheckFailed] = useState(false)

  const { isLoading: isSaving, runAsync: runAsyncSave } = useAsync<{
    success: boolean
    check?: { ok?: boolean; message?: string }
  }>()

  // The username is the account identity: required so that several accounts
  // on the same provider URL stay distinguishable.
  const canSubmit =
    !!form.provider && !!form.url && !!form.username && !!form.pat && !isSaving

  const finishLink = (server: { provider: string; url: string; username: string }) => {
    if (hideOnSuccess) onHide()
    if (onSuccess) onSuccess(server)
  }

  const handleSubmit = () => {
    setWarning('')
    setCheckFailed(false)
    runAsyncSave(
      postJSON('/user/git-pat/link', {
        body: {
          provider: form.provider,
          url: form.url,
          username: form.username,
          pat: form.pat,
        },
      })
    )
      .then(data => {
        const server = {
          provider: form.provider,
          url: form.url.replace(/\/+$/, ''),
          username: form.username,
        }
        if (data?.check && !data.check.ok) {
          setWarning(data.check.message || t('git_provider_test_failed'))
          setCheckFailed(true)
          return
        }
        finishLink(server)
      })
      .catch(err => setWarning(err?.data?.message || err?.message || t('something_went_wrong')))
  }

  return (
    <OLModal show={show} onHide={onHide} backdrop="static">
      <OLModalHeader closeButton>
        <OLModalTitle>{title || t('add_new_provider')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <p className="small">{t('link_git_sync_account_description')}</p>

        <GitProviderForm value={form} onChange={setForm} disabled={isSaving} />

        {warning && (
          <OLNotification type="warning" content={warning} />
        )}
      </OLModalBody>

      {checkFailed && (
        <OLNotification
          type="warning"
          content={
            <span>
              <OLButton
                variant="primary"
                size="sm"
                onClick={() =>
                  finishLink({
                    provider: form.provider,
                    url: form.url.replace(/\/+$/, ''),
                    username: form.username,
                  })
                }
              >
                {t('link_anyway')}
              </OLButton>
            </span>
          }
        />
      )}
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide} disabled={isSaving}>
          {cancelLabel || t('cancel')}
        </OLButton>

        <OLButton
          variant="primary"
          onClick={handleSubmit}
          disabled={!isSaving && !canSubmit}
          isLoading={isSaving}
        >
          {confirmLabel || t('link_account')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default GitProviderModal
