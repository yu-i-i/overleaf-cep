/**
 * Theme selector for the admin console sidebar (R11 item 14, 2026-08-30).
 *
 * Same fieldset as the project-list sidebar theme toggle
 * (theme-switch-Dark / -Light / -System radios), wired to the SAME save
 * path (POST /user/settings { overallTheme }) so the choice applies to
 * the admin pages (stored ace.overallTheme → ol-adminOverallTheme /
 * ol-userSettings) and the app pages alike. The admin page re-themes
 * immediately via the same body[data-theme] resolution the admin views
 * use; app pages pick it up on load, exactly like the app toggle does.
 */
import useSetOverallTheme from '@/features/editor-left-menu/hooks/use-set-overall-theme'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import { useTranslation } from 'react-i18next'

const ICON_BY_VAL: Record<string, string> = {
  'light-': 'light_mode',
  system: 'computer',
  '': 'dark_mode',
}

// The option list is the global res.locals.overallThemes (ExpressLocals),
// exposed as the ol-overallThemes meta on the manage-site view. This
// fallback keeps the widget robust if the meta is ever missing.
const FALLBACK_OPTIONS = [
  { name: 'Dark', val: '' },
  { name: 'Light', val: 'light-' },
  { name: 'System', val: 'system' },
]

export default function ThemeSelector() {
  const { t } = useTranslation()
  const {
    userSettings: { overallTheme },
  } = useUserSettingsContext()
  const setOverallTheme = useSetOverallTheme()

  // Immediate visual update on the admin surfaces (mirrors the
  // ol-adminOverallTheme resolution script shipped with the admin views).
  const applyNow = (val: string) => {
    try {
      const prefersDark = !!(
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      )
      const dark = val === 'system' ? prefersDark : val !== 'light-'
      document.body.dataset.theme = dark ? 'default' : 'light'
    } catch { /* keep the saved value even if theming fails */ }
  }

  const options =
    (getMeta<{ name: string; val: string }[]>('ol-overallThemes') || FALLBACK_OPTIONS) as {
      name: string
      val: string
    }[]

  return (
    <fieldset className="theme-selector" aria-label={t('theme')}>
      <legend>{t('theme')}</legend>
      <div className="theme-selector-radios">
        {options.map(theme => (
          <label
            key={theme.val || 'dark'}
            className="theme-selector-radio"
            htmlFor={`theme-switch-${theme.name}`}
            title={theme.name}
          >
            <input
              id={`theme-switch-${theme.name}`}
              type="radio"
              name="theme-selector"
              value={theme.val}
              checked={overallTheme === theme.val}
              onChange={() => {
                setOverallTheme(theme.val)
                applyNow(theme.val)
              }}
            />
            <MaterialIcon type={ICON_BY_VAL[theme.val] || 'dark_mode'} />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
