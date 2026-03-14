import moment from 'moment'
import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLButton from '@/shared/components/ol/ol-button'
import Cell from '@/features/settings/components/emails/cell'
import { Token } from '../../../../types/api'

type Props = {
  token: Token
  handleDeleteClick: (id: string) => void
}

function TokenTableRow({ token, handleDeleteClick }: Props) {
  const { t } = useTranslation()

  const created = moment(token.created_at).format('Do MMM YYYY')
  const lastUsed = token.lastUsedAt
    ? moment(token.lastUsedAt).format('Do MMM YYYY')
    : t('never')
  const expires = moment(token.expiresAt).format('Do MMM YYYY')

  const handleClick = () => handleDeleteClick(token._id)

  return (
    <OLRow className="small">
      <OLCol lg={4} className="linking-git-bridge-table-cell">
        <Cell>{token.accessTokenPartial + '************'}</Cell>
      </OLCol>

      <OLCol lg={2} className="linking-git-bridge-table-cell">
        <Cell>{created}</Cell>
      </OLCol>

      <OLCol lg={2} className="linking-git-bridge-table-cell">
        <Cell>{lastUsed}</Cell>
      </OLCol>

      <OLCol lg={3} className="linking-git-bridge-table-cell">
        <Cell>{expires}</Cell>
      </OLCol>

      <OLCol lg={1} className="linking-git-bridge-table-cell">
        <Cell>
          <OLButton
            className="linking-git-bridge-revoke-button icon-button-small"
            variant="secondary"
            aria-label={t('remove')}
            onClick={handleClick}
          >
            <span
              className="material-symbols icon-small"
              aria-hidden="true"
            >
              delete
            </span>
          </OLButton>
        </Cell>
      </OLCol>
    </OLRow>
  )
}

export default TokenTableRow
