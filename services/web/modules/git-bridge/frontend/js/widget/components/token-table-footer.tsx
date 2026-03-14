import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLButton from '@/shared/components/ol/ol-button'
import Cell from '@/features/settings/components/emails/cell'

type Props = {
  tokenCount: number
  limitReached: boolean
  onCreateToken: () => void
  isLoading: boolean
}

export default function TokenTableFooter({
  tokenCount,
  limitReached,
  onCreateToken,
  isLoading,
}: Props) {
  const { t } = useTranslation()

  if (tokenCount === 0) return null

  return (
    <>
      <div className="horizontal-divider" />
      <div className="affiliations-table-row-highlighted">
        <OLRow className="small">
          <OLCol lg={12}>
            <Cell>
              {limitReached ? (
                <p>{t('token_limit_reached')}</p>
              ) : (
                <OLButton
                  variant="link"
                  className="btn-inline-link"
                  onClick={onCreateToken}
                  disabled={isLoading}
                >
                  {t('add_another_token')}
                </OLButton>
              )}
            </Cell>
          </OLCol>
        </OLRow>
      </div>
    </>
  )
}
