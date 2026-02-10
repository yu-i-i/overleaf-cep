import { useEffect } from 'react'
import { useProjectListContext } from '../context/project-list-context'
import { Sort } from '../../../../types/project/api'
import { SortingOrder } from '../../../../../../types/sorting-order'

const toggleSort = (order: SortingOrder): SortingOrder =>
  order === 'asc' ? 'desc' : 'asc'

function useSort() {
  const { filter, sort, setSort, setCurrentPage } = useProjectListContext()

  const handleSort = (by: Sort['by']) => {
    setCurrentPage(1)
    setSort(prev => ({
      by,
      order: prev.by === by ? toggleSort(prev.order) : prev.order,
    }))
  }

  useEffect(() => {
    if (filter === 'deleted' && sort.by === 'lastUpdated') {
      setCurrentPage(1)
      setSort(prev => ({ ...prev, by: 'deletedAt' }))
    }

    if (filter !== 'deleted' && sort.by === 'deletedAt') {
      setCurrentPage(1)
      setSort(prev => ({ ...prev, by: 'lastUpdated' }))
    }
  }, [filter, sort.by, setSort, setCurrentPage])

  return { handleSort }
}

export default useSort
