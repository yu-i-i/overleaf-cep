import { Project, Sort } from '../../../../types/project/api'
import { SortingOrder } from '../../../../../../types/sorting-order'
import { Compare } from '../../../../../../types/helpers/array/sort'
import { User } from '../../../../types/user/api'

const order = (order: SortingOrder, projects: Project[]) => {
  return order === 'asc' ? [...projects] : projects.reverse()
}

export const ownerNameComparator =
  (getUserById: (userId: string) => User | null) =>
  (v1: Project, v2: Project) => {
    const user1 = getUserById(v1.owner)
    const user2 = getUserById(v2.owner)

    if (!user1) {
      if (!user2) {
        return v1.lastUpdated < v2.lastUpdated
          ? Compare.SORT_A_BEFORE_B
          : Compare.SORT_A_AFTER_B
      }
      return Compare.SORT_A_AFTER_B
    }

    if (!user2) {
      return Compare.SORT_A_BEFORE_B
    }

    const lastNameCmp = user1.lastName.localeCompare(user2.lastName)
    if (lastNameCmp !== 0) return lastNameCmp

    const firstNameCmp = user1.firstName.localeCompare(user2.firstName)
    if (firstNameCmp !== 0) return firstNameCmp

    return v1.lastUpdated < v2.lastUpdated
      ? Compare.SORT_A_BEFORE_B
      : Compare.SORT_A_AFTER_B
  }

export const defaultComparator = (
  v1: Project,
  v2: Project,
  key: 'name' | 'lastUpdated' | 'deletedAt'
) => {
  const value1 = v1[key]?.toLowerCase()
  const value2 = v2[key]?.toLowerCase()

  if (value1 !== value2) {
    if (value1 === undefined) return Compare.SORT_A_BEFORE_B
    if (value2 === undefined) return Compare.SORT_A_AFTER_B
    return value1 < value2 ? Compare.SORT_A_BEFORE_B : Compare.SORT_A_AFTER_B
  }

  return Compare.SORT_KEEP_ORDER
}

export default function sortProjects(
  projects: Project[], 
  sort: Sort,
  getUserById: (userId: string) => string
) {
  let sorted = [...projects]

  if (sort.by === 'title') {
    sorted = sorted.sort((...args) => {
      return defaultComparator(...args, 'name')
    })
  }

  if (sort.by === 'lastUpdated') {
    sorted = sorted.sort((...args) => {
      return defaultComparator(...args, 'lastUpdated')
    })
  }

  if (sort.by === 'deletedAt') {
    sorted = sorted.sort((...args) => {
      return defaultComparator(...args, 'deletedAt')
    })
  }

  if (sort.by === 'owner') {
    sorted.sort(ownerNameComparator(getUserById))
  }

  return order(sort.order, sorted)
}
