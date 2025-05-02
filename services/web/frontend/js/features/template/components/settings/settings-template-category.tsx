import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import SettingsMenuSelect from './settings-menu-select'
import type { Option } from './settings-menu-select'

export type SettingsTemplateCategoryProps = {
  value: string
  onChange: (value: string) => void
}

export default function SettingsTemplateCategory({
  value,
  onChange,
}: SettingsTemplateCategoryProps) {
  const { t } = useTranslation()

  const { templateLinks = [] } = getMeta('ol-ExposedSettings') as {
    templateLinks?: Array<{ name: string; url: string; description: string }>
  }

  if (templateLinks.length === 0) {
    return null
  }

  const options: Option[] = useMemo(
    () =>
      templateLinks.map(({ name, url }) => ({
        value: url,
        label: name,
      })),
    [templateLinks]
  )

  return (
    <SettingsMenuSelect
      name="category"
      label={t('template_category')}
      value={value}
      onChange={onChange}
      options={options}
    />
  )
}
