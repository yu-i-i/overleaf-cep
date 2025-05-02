import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { useDetachCompileContext as useCompileContext } from '@/shared/context/detach-compile-context'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import EditorManageTemplateModalWrapper from './manage-template-modal/editor-manage-template-modal-wrapper'

type TemplateManageResponse = {
  template_id: string
}

const MenubarManageTemplate = () => {
  const { t } = useTranslation()
  const { pdfUrl } = useCompileContext()

  const [showManageTemplateModal, setShowManageTemplateModal] = useState(false)

  const publishAsTemplateEnabled =
    getMeta('ol-showTemplatesServerPro') && pdfUrl

  useCommandProvider(
    () => [
      {
        type: 'command',
        id: 'manage-template',
        label: t('publish_as_template'),
        disabled: !publishAsTemplateEnabled,
        handler: () => {
          setShowManageTemplateModal(true)
        },
      },
    ],
    [t, publishAsTemplateEnabled]
  )

  const openTemplate = useCallback(
    ({ template_id: templateId }: TemplateManageResponse) => {
      location.assign(`/template/${templateId}`)
    },
    []
  )

  return (
    <EditorManageTemplateModalWrapper
      show={showManageTemplateModal}
      handleHide={() => setShowManageTemplateModal(false)}
      openTemplate={openTemplate}
    />
  )
}

export default MenubarManageTemplate
