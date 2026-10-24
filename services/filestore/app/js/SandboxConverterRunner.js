// SandboxConverterRunner.js
//
// Runs a PDF→image conversion (pdftocairo) in a throwaway sibling container,
// the same isolation profile CLSI's DockerRunner gives its conversion
// containers (see services/clsi/app/js/DockerRunner.mjs and the `conversions`
// / `png2pdf` compile groups in services/clsi/config/settings.defaults.cjs):
//
//   - no network access            (HostConfig.NetworkMode: 'none')
//   - all capabilities dropped     (HostConfig.CapDrop: ['ALL'])
//   - no new privileges            (SecurityOpt: 'no-new-privileges')
//   - hard memory cap
//   - numeric uid:gid of the overleaf service user (the scratch-based
//     converter images have no passwd entries, so named users fail)
//   - container is always removed afterwards
//
// Implemented as a minimal Docker Engine API client over the unix socket so
// that no new npm dependency is required (this service is installed with
// Yarn PnP; cross-service packages such as dockerode are not resolvable
// here).
//
// IMPORTANT (bind mounts): the daemon runs on the Docker host, so the
// bind source MUST be a daemon-host-visible path (in this deployment:
// under the overleaf `./data` volume), never a container-internal path
// such as /tmp. The caller passes a `hostDir` that satisfies this.

import http from 'node:http'
import Path from 'node:path'
import Fs from 'node:fs'
import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import Errors from './Errors.js'

const { ConversionError } = Errors

const API_VERSION = 'v1.43' // conservative; the engine API is backwards compatible

/**
 * One request against the Docker Engine API on a unix socket.
 *
 * @param {string} socketPath
 * @param {string} method
 * @param {string} apiPath e.g. `/v1.43/containers/create?name=xyz`
 * @param {object} [opts]
 * @param {object|string} [opts.body] JSON body
 * @param {number} [opts.timeoutMs] hard deadline for the whole request
 * @param {Buffer|null} [opts.expectRaw] pass a truthy value to keep the body
 *   as a Buffer (used for the log stream)
 * @return {Promise<{status: number, headers: object, body: any, raw: Buffer}>}
 */
function request(socketPath, method, apiPath, { body, timeoutMs = 60000, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined || body === null ? null : JSON.stringify(body)
    let settled = false
    const req = http.request(
      {
        socketPath,
        method,
        path: apiPath,
        headers: data
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(data),
            }
          : {},
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const buf = Buffer.concat(chunks)
          if (raw) return resolve({ status: res.statusCode, headers: res.headers, body: buf, raw: buf })
          let parsed = buf
          if (buf.length && (buf[0] === 0x7b || buf[0] === 0x5b)) {
            try {
              parsed = JSON.parse(buf.toString('utf8'))
            } catch (e) {
              // non-JSON body (e.g. plain text) — keep buffer
              parsed = buf
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: buf })
        })
      }
    )
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      req.destroy()
      reject(new Error(`docker api ${method} ${apiPath} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    req.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    if (data) req.write(data)
    req.end()
  })
}

/** Decode the framed (TTY=false) docker log stream. */
function decodeLogStream(buf) {
  if (!buf || !buf.length) return ''
  // 8-byte header per frame: [stream(1)] [size_be32(4)] [reserved(3)] + payload
  // (older daemons use a 4-byte header; try the 8-byte layout first)
  let out = ''
  let i = 0
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4)
    if (i + 8 + size > buf.length) break
    if (buf[i] === 1 || buf[i] === 2) out += buf.subarray(i + 8, i + 8 + size).toString('utf8')
    i += 8 + size
  }
  return out || buf.toString('utf8')
}

/**
 * Best-effort sweep of leftover `filestore-convert-*` containers from crashes
 * or service restarts mid-run (a container that was created but never started
 * or removed otherwise would leak forever).
 */
async function _sweepLeftovers(socketPath) {
  let res
  try {
    res = await request(
      socketPath,
      'GET',
      `/${API_VERSION}/containers/json?all=1&limit=200&filters=%7B%22name%22%3A%5B%22filestore-convert-%22%5D%7D`,
      { timeoutMs: 10000 }
    )
  } catch (err) {
    return // not fatal
  }
  if (res.status !== 200 || !Array.isArray(res.body)) return
  for (const c of res.body) {
    if (typeof c.Names?.[0] === 'string' && c.Names[0].startsWith('/filestore-convert-')) {
      const name = c.Names[0].slice(1)
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await request(socketPath, 'DELETE', `/${API_VERSION}/containers/${name}?force=1`, { timeoutMs: 10000 })
          logger.warn({ name }, 'sandbox conversion: removed leftover container')
          break
        } catch (err) {
          if (attempt === 0) continue
          logger.warn({ err, name }, 'sandbox conversion: failed to remove leftover container')
        }
      }
    }
  }
}

/**
 * Run a conversion in a sandboxed container.
 *
 * Layout contract (mirrors CLSI's conversion runner):
 *   host:  <hostDir>/<runId>/input.pdf          <- the source file (copied in)
 *   host:  <hostDir>/<runId>/<outputBase>.<ext> <- produced by the container
 *
 * @param {object} opts
 * @param {string} opts.sourcePath absolute path to the source PDF (must be
 *   inside a daemon-host-visible directory — the bind source is derived from it)
 * @param {string} opts.containerArgs full argv inside the container, e.g.
 *   ['pdftocairo','-png','-singlefile','-scale-to-x','700','-scale-to-y','-1',
 *    '/work/input.pdf','/work/output']
 * @param {string} opts.workDir basename mapping used in `containerArgs`; the
 *   source file is placed at <workDir>/input.pdf inside the container
 * @param {string} opts.outputBase container-side output basename (without ext)
 * @param {string} opts.outputExt 'png' or 'jpg'
 * @param {string} opts.destPath absolute host path where the result must end up
 * @return {Promise<{container: string, exitCode: number, outputHostPath: string, durationMs: number}>}
 */
export async function runConversion(opts) {
  const {
    sourcePath,
    containerArgs,
    workDir = '/work',
    outputBase = 'output',
    outputExt = 'png',
    destPath,
  } = opts

  const sandbox = Settings.sandboxConversion || {}
  const image = sandbox.image || 'sharelatex/pdftocairo:24.02'
  const socketPath = sandbox.dockerSocketPath || '/var/run/docker.sock'
  const hostDir = sandbox.hostDir // daemon-host side of the scratch dir
  const containerDir = sandbox.containerDir // overleaf-container side
  const memoryBytes = sandbox.memoryBytes || 512 * 1024 * 1024
  const timeoutMs = sandbox.timeoutMs || 40000

  if (!hostDir || !containerDir) {
    throw new ConversionError(
      'sandbox conversion is not configured: set CONVERSION_SANDBOX_HOST_DIR (Docker-daemon side) and CONVERSION_SANDBOX_DIR (overleaf-container side) to the two views of the same directory'
    )
  }

  const runId = crypto.randomBytes(8).toString('hex')
  const runName = `filestore-convert-${runId}`
  const runDir = Path.join(containerDir, runId) // path used by THIS process (container side)
  const hostRunDir = Path.join(hostDir, runId) // same dir from the daemon side (bind source)
  const inputHostPath = Path.join(runDir, 'input.pdf')
  const outputHostPath = Path.join(runDir, `${outputBase}.${outputExt}`)

  const t0 = Date.now()
  let containerCreated = false
  try {
    // Guard against leftover containers from an interrupted previous run.
  await _sweepLeftovers(socketPath)

  Fs.mkdirSync(runDir, { mode: 0o770 })
    Fs.copyFileSync(sourcePath, inputHostPath)

    // Container-absolute path of the source file, for argv remapping sanity
    const sourceInContainer = Path.join(workDir, 'input.pdf')
    if (!containerArgs.some((a) => a === sourceInContainer)) {
      throw new ConversionError(
        `sandbox argv does not reference ${sourceInContainer} — refusing to run`
      )
    }

    // Create (the converter images are scratch-based: no ENTRYPOINT, so a bare
    // Cmd list is what CLSI runs successfully too).
    const createBody = {
      Image: image,
      Cmd: containerArgs,
      WorkingDir: workDir,
      // scratch-based images have no passwd entries — run as the numeric
      // uid:gid of this service (it owns the files on both sides of the bind).
      User: `${process.getuid()}:${process.getgid()}`,
      HostConfig: {
        Binds: [`${hostRunDir}:${workDir}:rw`],
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        NetworkMode: 'none',
        Memory: memoryBytes,
        MemorySwap: 0,
        PidsLimit: 64,
      },
    }
    const created = await request(socketPath, 'POST', `/${API_VERSION}/containers/create?name=${runName}`, {
      body: createBody,
      timeoutMs: 60000,
    })
    if (created.status >= 300 || !created.body?.Id) {
      const msg = created.body?.message || JSON.stringify(created.body) || `status ${created.status}`
      throw new ConversionError(`failed to create sandbox container: ${msg}`)
    }
    containerCreated = true
    logger.info({ image, runName, hostDir: hostRunDir, containerDir: runDir }, 'sandbox conversion: container created')

    await request(socketPath, 'POST', `/${API_VERSION}/containers/${runName}/start`, { timeoutMs: 60000 })

    // Wait with a real deadline; kill on breach (the /wait call is a blocking
    // HTTP call that carries no data, so it gets its own generous budget).
    let exitCode = -1
    let killed = false
    try {
      // NOTE: this daemon (Docker 29 / API ≥1.44) requires POST for /wait; GET
      // returns 404. (dockerode does the same, which is how CLSI waits.)
      const waited = await request(socketPath, 'POST', `/${API_VERSION}/containers/${runName}/wait`, {
        timeoutMs: timeoutMs + 15000,
      })
      exitCode = waited.body?.StatusCode ?? -1
      if (exitCode === -1 && waited.status !== 200) {
        throw new Error(`unexpected /wait status ${waited.status}: ${waited.raw?.toString?.('utf8') || 'no body'}`)
      }
    } catch (waitErr) {
      killed = true
      await _killAndRemove(socketPath, runName)
      throw new ConversionError(`sandbox conversion timed out (${timeoutMs}ms): ${waitErr.message}`)
    }

    let logs = ''
    try {
      const logsRes = await request(
        socketPath,
        'GET',
        `/${API_VERSION}/containers/${runName}/logs?stdout=1&stderr=1&stdin=0&follow=1`,
        { raw: true, timeoutMs: 10000 }
      )
      logs = decodeLogStream(logsRes.raw)
    } catch (err) {
      logger.warn({ err, runName }, 'sandbox conversion: could not read container logs')
    }

    if (exitCode !== 0) {
      throw new ConversionError(
        `sandbox conversion failed (exit ${exitCode}${killed ? ', killed' : ''})`,
        { stderr: logs.trim().slice(-4000), exitCode }
      )
    }

    let stat
    try {
      stat = Fs.statSync(outputHostPath)
    } catch (err) {
      throw new ConversionError(`sandbox conversion produced no output file`, { stderr: logs.trim().slice(-4000) })
    }
    if (!stat.isFile()) {
      throw new ConversionError('sandbox conversion output is not a regular file', {
        stderr: logs.trim().slice(-4000),
      })
    }

    Fs.copyFileSync(outputHostPath, destPath)
    logger.info(
      { runName, sizeBytes: stat.size, durationMs: Date.now() - t0 },
      'sandbox conversion completed'
    )
    return { container: runName, exitCode, outputHostPath: destPath, durationMs: Date.now() - t0 }
  } finally {
    // Best-effort cleanup: container + scratch dir (the dir holds the original
    // PDF — do not leave it behind).
    if (containerCreated) {
      await _killAndRemove(socketPath, runName).catch((e) => {
        logger.warn({ err: e, runName }, 'sandbox conversion: cleanup failed')
      })
    }
    Fs.rmSync(runDir, { recursive: true, force: true })
  }
}

async function _killAndRemove(socketPath, name) {
  try {
    // POST /kill (GET is not served by this daemon); 409 = not running → fine
    await request(socketPath, 'POST', `/${API_VERSION}/containers/${name}/kill`, { timeoutMs: 10000 })
  } catch (err) {
    // not running → fine
  }
  try {
    await request(socketPath, 'DELETE', `/${API_VERSION}/containers/${name}?force=1`, { timeoutMs: 10000 })
  } catch (err) {
    // already gone → fine
  }
}

export default { runConversion }
