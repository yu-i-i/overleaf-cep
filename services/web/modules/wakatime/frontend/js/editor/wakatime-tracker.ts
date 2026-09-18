import { postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

// WakaTime clients only send a heartbeat if more than this long has passed
// since the last one for the same file, or the file was switched/saved.
const HEARTBEAT_THROTTLE_MS = 2 * 60 * 1000

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  tex: 'LaTeX',
  ltx: 'LaTeX',
  sty: 'TeX',
  cls: 'TeX',
  bib: 'BibTeX',
  bbx: 'TeX',
  cbx: 'TeX',
  md: 'Markdown',
  rnw: 'R',
  py: 'Python',
  r: 'R',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
}

function languageForFile(fileName: string): string | undefined {
  const match = /\.([^./]+)$/.exec(fileName)
  const ext = match?.[1]?.toLowerCase()
  return ext ? EXTENSION_TO_LANGUAGE[ext] : undefined
}

const lastHeartbeatAt = new Map<string, number>()

function buildHeartbeat(docName: string, isWrite: boolean) {
  const heartbeat: Record<string, unknown> = {
    entity: docName,
    type: 'file',
    time: Date.now() / 1000,
    is_write: isWrite,
  }
  const language = languageForFile(docName)
  if (language) heartbeat.language = language
  return heartbeat
}

function send(projectId: string, docName: string, isWrite: boolean) {
  const heartbeat = buildHeartbeat(docName, isWrite)
  postJSON(`/project/${projectId}/wakatime/heartbeat`, {
    body: heartbeat,
  }).catch(err => {
    // WakaTime not linked, unreachable, etc — never surface this to the user
    debugConsole.log('wakatime heartbeat not sent', err?.message || err)
  })
  lastHeartbeatAt.set(docName, Date.now())
}

/** Called whenever the user opens/switches to a file in the editor. */
export function notifyFileOpened(projectId: string, docName: string) {
  send(projectId, docName, false)
}

/**
 * Called on every local (non-collaborator, non-undo/reject) CodeMirror edit.
 * Throttled to at most one heartbeat per file per HEARTBEAT_THROTTLE_MS.
 */
export function notifyLocalEdit(projectId: string, docName: string) {
  const last = lastHeartbeatAt.get(docName) || 0
  if (Date.now() - last < HEARTBEAT_THROTTLE_MS) return
  send(projectId, docName, false)
}

/** Called when the document has just been saved (acked by ShareJS). */
export function notifyFileSaved(projectId: string, docName: string) {
  send(projectId, docName, true)
}
