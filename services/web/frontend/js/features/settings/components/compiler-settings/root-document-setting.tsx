import { useProjectSettingsContext } from '@/features/editor-left-menu/context/project-settings-context'
import DropdownSetting from '../dropdown-setting'
import { useMemo } from 'react'
import type { Option } from '../dropdown-setting'
import { useTranslation } from 'react-i18next'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { isValidTeXFile } from '@/main/is-valid-tex-file'
import { useSetCompilationSettingWithEvent } from '@/features/editor-left-menu/hooks/use-set-compilation-setting'

export default function RootDocumentSetting() {
  const { rootDocId, setRootDocId, compiler } = useProjectSettingsContext()
  const { t } = useTranslation()
  const { write } = usePermissionsContext()
  const { docs } = useFileTreeData()
  const changeRootDocId = useSetCompilationSettingWithEvent(
    'root-doc-id',
    setRootDocId,
    { omitValueInEvent: true }
  )

  const validDocsOptions = useMemo(() => {
    const isTypst = compiler === 'typst'
    const filteredDocs =
      docs?.filter(doc => {
        if (rootDocId === doc.doc.id) return true
        const isTypFile = /\.typ$/i.test(doc.doc.name)
        return isTypst ? isTypFile : (isValidTeXFile(doc.doc.name) && !isTypFile)
      }) ?? []

    const mappedDocs: Array<Option> = filteredDocs.map(doc => ({
      value: doc.doc.id,
      label: doc.path,
    }))

    if (!rootDocId) {
      mappedDocs.unshift({
        value: '',
        label: 'None',
        disabled: true,
      })
    }

    return mappedDocs
  }, [docs, rootDocId, compiler])

  return (
    <DropdownSetting
      id="rootDocId"
      label={t('main_document')}
      description={`${t('the_primary_file_for_compiling_your_project')} ${t('you_can_also_right_click_a_file_to_set_it_as_main')}`}
      disabled={!write}
      options={validDocsOptions}
      onChange={changeRootDocId}
      value={rootDocId ?? ''}
      translateOptions="no"
    />
  )
}
