import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

let ProjectInspectionModule = {}

if (process.env.PROJECT_INSPECTION_ENABLED?.toLowerCase()  === 'true') {
  logger.debug({}, 'Enabling project inspection module')

  Settings.projectInspection = {
    enable: true,
    maxSourceBytes: parsePositiveInteger(process.env.PROJECT_INSPECTION_MAX_SOURCE_MB, 25) * 1024 * 1024,
    maxBibBytes: parsePositiveInteger(process.env.PROJECT_INSPECTION_MAX_BIB_MB, 0) * 1024 * 1024 ||
      Math.min(6 * 1024 * 1024, 3 * Settings.max_doc_length),
    maxTotalBibBytes: parsePositiveInteger(process.env.PROJECT_INSPECTION_MAX_TOTAL_BIB_MB, 25) * 1024 * 1024,
    maxConcurrency: parsePositiveInteger(process.env.PROJECT_INSPECTION_WORKER_CONCURRENCY, 2),
    timeoutMS: parsePositiveInteger(process.env.PROJECT_INSPECTION_TIMEOUT_MS, 30_000),
  }

  const { default: ProjectInspectionRouter } = await import('./app/src/ProjectInspectionRouter.mjs')
  ProjectInspectionModule = {
    router: ProjectInspectionRouter,
  }
}

export default ProjectInspectionModule
