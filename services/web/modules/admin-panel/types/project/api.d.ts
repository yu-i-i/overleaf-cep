import { SortingOrder } from '../../../../types/sorting-order'
import { MergeAndOverride } from '../../../../types/utils'

export type Page = {
  size: number
  lastId?: string
}

export type Sort = {
  by: 'lastUpdated' | 'title' | 'deletedAt'
  order: SortingOrder
}

export type Filters = {
  owned?: boolean
  trashed?: boolean
  deleted?: boolean
  search?: string
}

export type GetProjectsRequestBody = {
  page: Page
  sort: Sort
  filters: Filters
}

export type UserRef = {
  id: string
  email: string
  firstName: string
  lastName: string
}

export type ProjectApi = {
  id: string
  name: string
  owner?: UserRef
  lastUpdated: Date
  lastUpdatedBy: UserRef | null
  trashed: boolean
  deleted: boolean
  deletedBy?: UserRef
  deletedAt?: Date
}

export type Project = MergeAndOverride<
  ProjectApi,
  {
    lastUpdated: string
    deletedAt?: string
    selected?: boolean
  }
>

export type GetProjectsResponseBody = {
  totalSize: number
  projects: Project[]
}
