import Settings from '@overleaf/settings'
import { Worker } from 'node:worker_threads'
import pLimit from 'p-limit'
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
  ProjectInspectionError,
} from './ProjectInspectionErrors.mjs'


const limit = pLimit(Settings.projectInspection.maxConcurrency)

async function run(snapshot, { signal } = {}) {
  if (signal?.aborted) throw new AnalysisCancelledError()

  return await limit(() => {
    if (signal?.aborted) throw new AnalysisCancelledError()
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('./analyzer/analysis-worker.mjs', import.meta.url),
        { workerData: snapshot }
      )
      let settled = false

      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        callback(value)
      }

      const onAbort = () => {
        worker.terminate().catch(() => {})
        finish(reject, new AnalysisCancelledError())
      }

      const timeout = setTimeout(() => {
        worker.terminate().catch(() => {})
        finish(reject, new AnalysisTimeoutError())
      }, Settings.projectInspection.timeoutMS)

      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      worker.on('message', message => {
        if (message?.['watch:require'] || message?.['watch:import']) return
        if (message?.ok) {
          finish(resolve, message.result)
        } else {
          finish(
            reject,
            new ProjectInspectionError(
              message?.error?.message ?? 'inspection_error_worker_failed',
              { code: message?.error?.code }
            )
          )
        }
      })
      worker.once('error', error => {
        finish(
          reject,
          new ProjectInspectionError('inspection_error_worker_failed', {
            cause: error,
          })
        )
      })
      worker.once('exit', code => {
        if (code !== 0 && !settled) {
          finish(
            reject,
            new ProjectInspectionError('inspection_error_worker_exit', {
              params: { code },
            })
          )
        }
      })
    })
  })
}

export default { run }
