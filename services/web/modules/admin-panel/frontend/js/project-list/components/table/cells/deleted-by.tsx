import { FC } from 'react'
import { UserRef } from '../../../../../../types/project/api'
import { useTranslation } from 'react-i18next'
import { getUserName } from '../../../util/user'

export const DeletedBy: FC<{
  deletedBy: UserRef
  deletedAtDate: string
}> = ({ deletedBy, deletedAtDate }) => {
  const { t } = useTranslation()

  const userName = getUserName(deletedBy)

  return (
    <>
      {t('last_updated_date_by_x', {
        lastUpdatedDate: deletedAtDate,
        person: userName,
      })}
    </>
  )
}
