import { useTranslation } from 'react-i18next'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'

export type GitProviderFormState = {
  provider: string
  url: string
  username: string
  pat: string
}

export const GIT_PROVIDERS: { value: string; labelKey: string; defaultUrl: string }[] = [
  { value: 'github', labelKey: 'github', defaultUrl: 'https://github.com' },
  { value: 'gitlab', labelKey: 'gitlab', defaultUrl: 'https://gitlab.com' },
  { value: 'gitea', labelKey: 'gitea', defaultUrl: 'https://gitea.com' },
  { value: 'forgejo', labelKey: 'forgejo', defaultUrl: 'https://codeberg.org' },
]

type GitProviderFormProps = {
  value: GitProviderFormState
  onChange: (next: GitProviderFormState) => void
  disabled?: boolean
}

/**
 * Shared form fields for registering a git provider with a personal
 * access token. Used both in user settings and the project editor.
 */
const GitProviderForm = ({ value, onChange, disabled = false }: GitProviderFormProps) => {
  const { t } = useTranslation()

  // PAT permission help, per provider (plan U2: the #1 cause of link failures)
  const providerScopes: Record<string, string> = {
    github: t('git_provider_scopes_github'),
    gitlab: t('git_provider_scopes_gitlab'),
    gitea: t('git_provider_scopes_gitea'),
    forgejo: t('git_provider_scopes_forgejo'),
  }

  const setProvider = (provider: string) => {
    const def = GIT_PROVIDERS.find(p => p.value === provider)
    onChange({
      ...value,
      provider,
      url: def ? def.defaultUrl : value.url,
    })
  }

  return (
    <OLForm>
      <OLFormGroup>
        <OLFormLabel htmlFor="git-provider-select" className="pb-1">
          {t('select_provider')}
        </OLFormLabel>
        <OLFormSelect
          id="git-provider-select"
          value={value.provider}
          onChange={e => setProvider(e.target.value)}
          disabled={disabled}
        >
          {GIT_PROVIDERS.map(p => (
            <option key={p.value} value={p.value}>
              {t(p.labelKey)}
            </option>
          ))}
        </OLFormSelect>
      </OLFormGroup>

      <OLFormGroup>
        <OLFormLabel className="pb-1" htmlFor="git-provider-url">
          {t('server_url')}
        </OLFormLabel>
        <OLFormControl
          type="url"
          id="git-provider-url"
          value={value.url}
          onChange={e => onChange({ ...value, url: e.target.value })}
          placeholder="https://git.example.com"
          disabled={disabled}
        />
      </OLFormGroup>

      <OLFormGroup>
        <OLFormLabel className="pb-1" htmlFor="git-provider-username">
          {t('username')}
        </OLFormLabel>
        <OLFormControl
          type="text"
          id="git-provider-username"
          value={value.username}
          onChange={e => onChange({ ...value, username: e.target.value })}
          placeholder={t('your_username')}
          disabled={disabled}
        />
      </OLFormGroup>

      <OLFormGroup>
        <OLFormLabel className="pb-1" htmlFor="git-provider-pat">
          {t('personal_access_token')}
        </OLFormLabel>
        <OLFormControl
          type="password"
          id="git-provider-pat"
          value={value.pat}
          onChange={e => onChange({ ...value, pat: e.target.value })}
          placeholder={t('enter_pat')}
          disabled={disabled}
          autoComplete="off"
        />
        <p className="small form-text mt-2 mb-1">{t('git_provider_scopes_intro')}</p>
        <p className="small form-text mb-0">
          {providerScopes[value.provider] || ''}
        </p>
      </OLFormGroup>
    </OLForm>
  )
}

export default GitProviderForm
