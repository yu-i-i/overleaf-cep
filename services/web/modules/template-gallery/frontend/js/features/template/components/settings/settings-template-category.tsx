import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON } from '@/infrastructure/fetch-json'
import SettingsMenuSelect from './settings-menu-select'
import type { Option } from './settings-menu-select'

interface SettingsTemplateCategoryProps {
  value: string
  onChange: (value: string) => void
}

/**
 * R6 item 6 (2026-08-29): the select used to expose only the static env
 * seed `ol-ExposedSettings.templateLinks` (on this deployment just
 * "All templates"), so the admin-managed categories were missing.
 * Now: enabled categories are loaded per request from
 * GET /api/template/categories (the same list the gallery uses); the
 * static meta list is only a fallback if that API is unavailable.
 */
const SettingsTemplateCategory: React.FC<SettingsTemplateCategoryProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [apiCategories, setApiCategories] = useState<
    Array<{ key: string; name: string }> | null
  >(null)

  useEffect(() => {
    let cancelled = false
    getJSON('/api/template/categories')
      .then((cats: unknown) => {
        if (!cancelled && Array.isArray(cats)) {
          setApiCategories(cats as Array<{ key: string; name: string }>)
        }
      })
      .catch(() => {
        /* keep the meta fallback */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const options: Option[] = useMemo(() => {
    const fallback = (
      getMeta('ol-ExposedSettings') as {
        templateLinks?: Array<{ name: string; url: string; description: string }>
      }
    )?.templateLinks || []

    if (apiCategories) {
      return apiCategories
        .filter(c => c && (c.key || c.name))
        .map(c => ({
          value: `/templates/${c.key}`,
          label: c.name,
        }))
    }

    return fallback.map(({ name, url }) => ({
      value: url,
      label: name,
    }))
  }, [apiCategories])

  // Keep the current value selectable even if its category has been
  // disabled since the template was created.
  // (BUGFIX 2026-08-30, W4: `options.find()` returns a single Option, not
  // an array — spreading it as `[...current]` threw `TypeError: c is not
  // iterable` and crashed the Publish-as-Template modal whenever the
  // current value matched a known option (e.g. after the same-name
  // prefill resolves). Always keep `current` an array.)
  const found = options.find(o => o.value === value)
  const current: Option[] = found
    ? [found]
    : value
      ? [{ value, label: value.replace(/^\/templates\//, '') }]
      : []

  if (options.length === 0 && current.length === 0) {
    return null
  }

  return (
    <SettingsMenuSelect
      name="category"
      label={`${t('category')}:`}
      value={value}
      onChange={onChange}
      options={[...current, ...options.filter(o => o.value !== value)]}
    />
  )
}

export default React.memo(SettingsTemplateCategory)
