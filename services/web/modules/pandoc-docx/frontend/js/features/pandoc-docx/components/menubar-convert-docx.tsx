import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import { useProjectContext } from '@/shared/context/project-context'
import { useTranslation } from 'react-i18next'

const MenubarConvertDocx = () => {
    const { t } = useTranslation()
    const { projectId } = useProjectContext()

    useCommandProvider(
        () => [
            {
                type: 'command',
                id: 'convert_to_docx',
                label: t('convert_to_docx'),
                handler: () => {
                    if (!projectId) {
                        return
                    }
                    window.open(`/project/${projectId}/download/docx`, '_blank')
                },
            },
        ],
        [t, projectId]
    )

    return null
}

export default MenubarConvertDocx
