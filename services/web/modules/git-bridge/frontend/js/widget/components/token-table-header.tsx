import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import Cell from '@/features/settings/components/emails/cell'

export default function TokenTableHeader() {
  const { t } = useTranslation()

  return (
    <>
      <OLRow className="small">
        <OLCol lg={4} className="linking-git-bridge-table-cell">
          <Cell><strong>{t('token')}</strong></Cell>
        </OLCol>

        <OLCol lg={2} className="linking-git-bridge-table-cell">
          <Cell><strong>{t('created_at')}</strong></Cell>
        </OLCol>

        <OLCol lg={2} className="linking-git-bridge-table-cell">
          <Cell><strong>{t('last_used')}</strong></Cell>
        </OLCol>

        <OLCol lg={3} className="linking-git-bridge-table-cell">
          <Cell><strong>{t('expires')}</strong></Cell>
        </OLCol>
      </OLRow>

      <div className="horizontal-divider" />
      <div className="horizontal-divider" />
    </>
  )
}
