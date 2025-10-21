import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import SettingsMenuSelect from './settings-menu-select'
import type { Option } from './settings-menu-select'

interface SettingsTemplateCategoryProps {
  value: string
  onChange: (value: string) => void
}

const SettingsTemplateCategory: React.FC<SettingsTemplateCategoryProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  const options: Option[] = useMemo(() => {
    const { templateLinks = [] } = getMeta('ol-ExposedSettings') as {
      templateLinks?: Array<{ name: string; url: string; description: string }>
    }

    return templateLinks.map(({ name, url }) => ({
      value: url,
      label: name,
    }))
  }, [])

  if (options.length === 0) {
    return null
  }

  return (
    <SettingsMenuSelect
      name="category"
      label={`${t('category')}:`}
      value={value}
      onChange={onChange}
      options={options}
    />
  )
}

export default React.memo(SettingsTemplateCategory)
