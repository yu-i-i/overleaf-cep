// @ts-check

/**
 * Runner for the upstream TypeScript enqueue script
 * `services/document-updater/scripts/project_notifications.mts`
 *
 * Upstream ships that `.mts` (real TS: typed annotations) with **no** runner
 * wired in — nothing references it and nothing compiles it. The `.mts`'s
 * relative imports (`../app/js/mongodb.js`) + `workspace:` `@overleaf/*`
 * deps live next to it, so this launcher:
 *
 *   1. transpiles the single file with esbuild (no bundle, CJS output),
 *      dropping it *next to* the source so relative imports still resolve
 *      against the upstream tree;
 *   2. execs `node` on that temp file, forwarding argv (e.g. `--dry-run`).
 *
 * The upstream script does the real enqueue work:
 *   - redis-scan for `ProjectNotificationTimestamp:{*}` keys (stamped by
 *     `document-updater/UpdateManager.applyUpdate` on `meta.tc` writes),
 *   - push a Bull `project-notification` job `{ projectId, timestamp }`.
 *
 * The queue is consumed by
 * `services/web/app/src/infrastructure/QueueWorkers.mjs` →
 * `Modules.hooks.projectModified` → this module's
 * `ScheduleProjectChangeNotifications` hook → `emailNotifications` upsert,
 * drained later by `scripts/process_notifications.mjs`.
 *
 * Invoked by `server-ce/cron/project-notification-enqueue.sh`.
 */
import { execSync } from 'child_process'
import path from 'path'
import os from 'os'
import fs from 'fs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
// this file: <repo>/services/web/scripts/run_project_notifications.mjs
const MTS = path.resolve(
  HERE,
  '../../document-updater/scripts/project_notifications.mts'
)
// Emit next to the source so its `../app/js/mongodb.js` etc. still resolve.
const OUT = path.join(path.dirname(MTS), '__enqueue.bundle.cjs.js')
const CANDIDATE_ESBUILD = [
  path.resolve(HERE, '../node_modules/.bin/esbuild'),
  path.resolve(HERE, '../../../node_modules/.bin/esbuild'),
  path.resolve(HERE, '../../../../node_modules/.bin/esbuild'),
]
const esbuildBin = CANDIDATE_ESBUILD.find(p => fs.existsSync(p))
if (!esbuildBin) {
  throw new Error(`esbuild not found among ${CANDIDATE_ESBUILD.join(', ')}`)
}

try {
  execSync(
    `"${esbuildBin}" "${MTS}" --platform=node --format=cjs --target=node22 ` +
      `--outfile="${OUT}"`,
    { stdio: 'inherit' }
  )
  execSync(`node "${OUT}" ${process.argv.slice(2).join(' ')}`, {
    stdio: 'inherit',
  })
} finally {
  // never leave the temp artifact behind
  try {
    fs.rmSync(OUT, { force: true })
  } catch {}
}
