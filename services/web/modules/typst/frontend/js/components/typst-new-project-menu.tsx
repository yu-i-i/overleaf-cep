import { DropdownItem } from '@/shared/components/dropdown/dropdown-menu'
import { useTranslation } from 'react-i18next'

type Props = {
    onClick: (e: React.MouseEvent) => void
}

function TypstNewProjectMenu({ onClick }: Props) {
    const { t } = useTranslation()
    return <DropdownItem onClick={onClick}>{t('blank_typst_project')}</DropdownItem>
}

export default TypstNewProjectMenu
