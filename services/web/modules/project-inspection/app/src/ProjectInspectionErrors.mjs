export class ProjectInspectionError extends Error {
  constructor(message, { code, statusCode, cause, params } = {}) {
    super(message, { cause })
    this.name = 'ProjectInspectionError'
    this.code = code ?? 'PROJECT_INSPECTION_ERROR'
    this.statusCode = statusCode ?? 500
    this.params = params
  }
}

export class InvalidEntryPointError extends ProjectInspectionError {
  constructor(message = 'inspection_error_invalid_entry_points') {
    super(message, { code: 'INVALID_ENTRY_POINT', statusCode: 400 })
  }
}

export class ProjectTooLargeError extends ProjectInspectionError {
  constructor(message = 'inspection_error_project_too_large', params) {
    super(message, { code: 'PROJECT_TOO_LARGE', statusCode: 413, params })
  }
}

export class AnalysisTimeoutError extends ProjectInspectionError {
  constructor(message = 'inspection_error_timed_out') {
    super(message, { code: 'ANALYSIS_TIMEOUT', statusCode: 504 })
  }
}

export class AnalysisCancelledError extends ProjectInspectionError {
  constructor(message = 'inspection_error_cancelled') {
    super(message, { code: 'ANALYSIS_CANCELLED', statusCode: 499 })
  }
}
