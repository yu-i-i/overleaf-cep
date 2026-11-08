import OError from '@overleaf/o-error'

class GitNotLinkedError extends OError {
  constructor(projectId) {
    super('git server is not linked to project', { projectId })
  }
}

class AlreadyExistsError extends OError {}
class GitConflictError extends OError {}
class InvalidTokenError extends OError {}
class ExpiredTokenError extends OError {}
class NotFoundError extends OError {}
class PermissionDeniedError extends OError {}
class RateLimitError extends OError {}
class ProviderRequestError extends OError {}
class GitSyncInterruptedError extends OError {
  constructor() {
    super('Project changed during Git synchronization or its result could not be verified; please synchronize again')
  }
}

export {
  AlreadyExistsError,
  GitNotLinkedError,
  GitConflictError,
  InvalidTokenError,
  ExpiredTokenError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ProviderRequestError,
  GitSyncInterruptedError,
}
