import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DeleteTokenModal from './modals/delete-token-modal'
import TokenTableHeader from './token-table-header'
import TokenTableRow from './token-table-row'
import TokenTableFooter from './token-table-footer'
import { Token } from '../../../../types/api'

const MAX_TOKENS = 10

type Props = {
  tokens: Token[]
  onCreateToken: () => void
  onDeleteToken: (id: string) => void
}

export default function TokenTable({
  tokens,
  onCreateToken,
  onDeleteToken,
}: Props) {
  const { t } = useTranslation()

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedTokenId, setSelectedTokenId] = useState('')

  const handleDeleteClick = (id: string) => {
    setSelectedTokenId(id)
    setShowDeleteModal(true)
  }

  const tokenCount = tokens.length
  const limitReached = tokenCount >= MAX_TOKENS

  return (
    <>
      {tokenCount > 0 && <TokenTableHeader />}

      {tokens.map((token) => (
        <TokenTableRow
          key={token._id}
          token={token}
          handleDeleteClick={handleDeleteClick}
        />
      ))}

      <TokenTableFooter
        tokenCount={tokenCount}
        limitReached={limitReached}
        onCreateToken={onCreateToken}
        isLoading={false}
      />

      <DeleteTokenModal
        show={showDeleteModal}
        tokenId={selectedTokenId}
        handleHide={() => setShowDeleteModal(false)}
        onDeleted={(id: string) => {
          onDeleteToken(id)
          setShowDeleteModal(false)
        }}
      />
    </>
  )
}
