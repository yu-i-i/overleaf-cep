/**
 * Online Compile Handler
 *
 * This module is registered via overleafModuleImports['onlineCompileHandler']
 * and provides the compile function used when online compile mode is active.
 *
 * It bridges the Overleaf compile context with the WASM compiler service,
 * converting project files into a format the WASM compiler understands
 * and the result back into the format Overleaf's PDF viewer expects.
 */
import {
  compileOnline,
  terminateWasm,
  type OnlineCompileResult,
} from './services/wasm-compiler'
import type { ProjectSnapshot } from '@/infrastructure/project-snapshot'
import type { CompileResponseData } from '../../../../types/compile'

/**
 * Build a CompileResponseData from WASM compile result.
 * This converts the WASM output into the same format the server returns,
 * so the existing PDF viewer and log display can consume it.
 */
function buildCompileResponse(
  result: OnlineCompileResult,
  pdfBlobUrl: string | null,
  logBlobUrl: string | null
): CompileResponseData {
  const buildId = `online-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const outputFiles: any[] = []

  if (result.pdf && pdfBlobUrl) {
    outputFiles.push({
      path: 'output.pdf',
      url: pdfBlobUrl,
      type: 'pdf',
      build: buildId,
      downloadURL: pdfBlobUrl,
      // Required PDFFile fields
      contentId: buildId,
      editorId: 'online-compile',
      size: result.pdf.byteLength,
      ranges: [],
    })
  }

  if (logBlobUrl) {
    outputFiles.push({
      path: 'output.log',
      url: logBlobUrl,
      type: 'log',
      build: buildId,
      downloadURL: logBlobUrl,
    })
  }

  return {
    status: result.success ? 'success' : 'failure',
    outputFiles,
    pdfCachingMinChunkSize: 0,
    validationProblems: null,
    options: {},
    stats: {
      'latex-runs': 1,
    },
    timings: {},
  }
}

// Track blob URLs for cleanup — only revoke after the viewer is done with them.
// Blob URLs are revoked at the START of the next compile (not at end of current),
// so the viewer always holds valid URLs for the lifetime of the current result.
let previousPdfBlobUrl: string | null = null
let previousLogBlobUrl: string | null = null

function cleanupBlobUrls() {
  if (previousPdfBlobUrl) {
    URL.revokeObjectURL(previousPdfBlobUrl)
    previousPdfBlobUrl = null
  }
  if (previousLogBlobUrl) {
    URL.revokeObjectURL(previousLogBlobUrl)
    previousLogBlobUrl = null
  }
}

// Compile deduplication: at most one compile in-flight + one pending (latest-wins).
// When auto-compile fires rapidly (e.g. on every save), intermediate requests are
// collapsed so we only run 2 compiles max: the current one and one catch-up.
interface PendingCompile {
  projectSnapshot: ProjectSnapshot
  rootDocPath: string
  projectId: string
  compilerName?: string
  resolve: (result: CompileResponseData) => void
  reject: (err: unknown) => void
}

let compileInFlight = false
let pendingCompile: PendingCompile | null = null

async function executeCompile(
  projectSnapshot: ProjectSnapshot,
  rootDocPath: string,
  projectId: string,
  compilerName?: string
): Promise<CompileResponseData> {
  // Revoke the previous compile's blobs now that a new compile is starting
  cleanupBlobUrls()

  try {
    // Refresh snapshot to get latest file contents
    await projectSnapshot.refresh()

    // Run WASM compilation
    const result = await compileOnline(
      projectSnapshot,
      rootDocPath,
      projectId,
      compilerName
    )

    // Create blob URLs for PDF and log
    let pdfBlobUrl: string | null = null
    if (result.pdf) {
      const pdfBlob = new Blob([result.pdf], { type: 'application/pdf' })
      pdfBlobUrl = URL.createObjectURL(pdfBlob)
      previousPdfBlobUrl = pdfBlobUrl
    }

    let logBlobUrl: string | null = null
    if (result.log) {
      const logBlob = new Blob([result.log], { type: 'text/plain' })
      logBlobUrl = URL.createObjectURL(logBlob)
      previousLogBlobUrl = logBlobUrl
    }

    return buildCompileResponse(result, pdfBlobUrl, logBlobUrl)
  } catch (error: any) {
    console.error('Online compile failed:', error)
    return {
      status: 'failure',
      outputFiles: [],
      pdfCachingMinChunkSize: 0,
      validationProblems: null,
      options: {},
    }
  }
}

/**
 * Main compile function called by the compile context when online mode is active.
 *
 * Uses a latest-wins queue: if a compile is already in flight, the new request is
 * stored as pending (replacing any earlier pending request). When the in-flight
 * compile finishes, the single pending compile runs. This prevents N back-to-back
 * full compile cycles when auto-compile fires faster than the WASM engine can run.
 *
 * @param projectSnapshot - Project snapshot for file access
 * @param rootDocPath - Path to the root .tex document
 * @param projectId - Project ID
 * @param compilerName - Compiler name from project settings
 * @returns CompileResponseData in the same format the server would return
 */
export async function handleOnlineCompile(
  projectSnapshot: ProjectSnapshot,
  rootDocPath: string,
  projectId: string,
  compilerName?: string
): Promise<CompileResponseData> {
  if (compileInFlight) {
    // Queue as latest pending — discard any earlier pending request
    return new Promise<CompileResponseData>((resolve, reject) => {
      pendingCompile = {
        projectSnapshot,
        rootDocPath,
        projectId,
        compilerName,
        resolve,
        reject,
      }
    })
  }

  compileInFlight = true
  try {
    return await executeCompile(projectSnapshot, rootDocPath, projectId, compilerName)
  } finally {
    compileInFlight = false
    // If a newer compile was requested while we were running, fire it now
    if (pendingCompile) {
      const { resolve, reject, ...args } = pendingCompile
      pendingCompile = null
      executeCompile(args.projectSnapshot, args.rootDocPath, args.projectId, args.compilerName)
        .then(resolve)
        .catch(reject)
    }
  }
}

/**
 * Clean up WASM resources.
 */
export function cleanup() {
  cleanupBlobUrls()
  terminateWasm()
}

export default {
  handleOnlineCompile,
  cleanup,
}
