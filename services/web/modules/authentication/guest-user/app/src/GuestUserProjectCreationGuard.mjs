import { User } from '../../../../../app/src/models/User.mjs'

const GUEST_USER_ROLE = 'guest-user'
export const GUEST_USER_PROJECT_CREATION_MESSAGE =
  'Your account is not allowed to create projects.'

export class GuestUserProjectCreationForbiddenError extends Error {
  constructor(message = GUEST_USER_PROJECT_CREATION_MESSAGE) {
    super(message)
    this.name = 'GuestUserProjectCreationForbiddenError'
  }
}

/**
 * Throws GuestUserProjectCreationForbiddenError if the user has the guest-user admin role.
 */
export async function assertUserMayCreateProject(ownerId) {
  const userWithRoles = await User.findById(ownerId, 'adminRoles').lean()
  if (
    Array.isArray(userWithRoles?.adminRoles) &&
    userWithRoles.adminRoles.includes(GUEST_USER_ROLE)
  ) {
    throw new GuestUserProjectCreationForbiddenError()
  }
}
