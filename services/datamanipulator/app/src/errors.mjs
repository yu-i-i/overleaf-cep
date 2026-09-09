

export class FileNotFoundError extends Error {
  constructor(path) {
    super(`File not found: ${path}`)
    this.name = 'FileNotFoundError'
    this.path = path
  }
}

export class DirectoryNotFoundError extends Error {
  constructor(path) {
    super(`Directory not found: ${path}`)
    this.name = 'DirectoryNotFoundError'
    this.path = path
  }
}

export class PermissionError extends Error {
  constructor(action, path) {
    super(`Permission denied: ${action} ${path}`)
    this.name = 'PermissionError'
    this.action = action
    this.path = path
  }
}

export class ConflictError extends Error {
  constructor(path, message = 'File conflict detected') {
    super(`${message}: ${path}`)
    this.name = 'ConflictError'
    this.path = path
  }
}
