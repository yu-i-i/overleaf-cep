import { useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '../../../utils/meta'
import SettingsMenuSelect from '@/features/editor-left-menu/components/settings/settings-menu-select'
import type { Option } from '@/features/editor-left-menu/components/settings/settings-menu-select'

interface ManageTemplateCategoryProps {
  category: string | null
  setCategory: (value: string) => void
}

export default function SettingsTemplateCategory({
  category,
  setCategory
}: ManageTemplateCategoryProps) {
  const { t } = useTranslation()

  const { templateLinks } = useMemo(
    () => getMeta('ol-ExposedSettings') || [],
    []
  )

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

  useEffect(() => {
    if (!category && options.length > 0) {
      setCategory(options[0].value)
    }
  }, [options, category, setCategory])

  return (
    <SettingsMenuSelect
      onChange={setCategory}
      value={category ?? ""}
      options={options}
      label={t('template_category')}
      name="category"
    />
  )
}
