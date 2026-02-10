import { useEffect } from 'react'
import { Sort } from '../../../../types/user/api'
import { SortingOrder } from '../../../../../../types/sorting-order'
import { useUserListContext } from '../context/user-list-context'

const toggleSort = (order: SortingOrder): SortingOrder => {
  return order === 'asc' ? 'desc' : 'asc'
}

function useSort() {
  const { filter, sort, setSort, setCurrentPage } = useUserListContext()

  const handleSort = (by: Sort['by']) => {
    setCurrentPage(1)
    setSort(prev => ({
      by,
      order: prev.by === by ? toggleSort(sort.order) : sort.order,
    }))
  }

  useEffect(() => {
    if (filter === 'deleted' && sort.by === 'signUpDate') {
      setCurrentPage(1)
      setSort(prev => ({ ...prev, by: 'deletedAt' }))
    }

    if (filter !== 'deleted' && sort.by === 'deletedAt') {
      setCurrentPage(1)
      setSort(prev => ({ ...prev, by: 'signUpDate' }))
    }
  }, [filter, sort.by, setSort, setCurrentPage])

  return { handleSort }
}

export default useSort
