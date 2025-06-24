import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '../../../../utils/meta'
import SettingsMenuSelect from './settings-menu-select'
import type { Optgroup } from './settings-menu-select'

interface SettingsLanguageProps {
  value: string
  onChange: (value: string) => void
}

export default function SettingsLanguage({
  value,
  onChange,
}: SettingsLanguageProps) {
  const { t } = useTranslation()

  const optgroup: Optgroup = useMemo(() => {
    const options = (getMeta('ol-languages') ?? [])
      // only include spell-check languages that are available in the client
      .filter(language => language.dic !== undefined)

    return {
      label: 'Language',
      options: options.map(language => ({
        value: language.code,
        label: language.name,
      })),
    }
  }, [])

  return (
    <SettingsMenuSelect
      onChange={onChange}
      value={value}
      options={[{ value: '', label: t('off') }]}
      optgroup={optgroup}
      label={t('spell_check')}
      name="spellCheckLanguage"
    />
  )
}
