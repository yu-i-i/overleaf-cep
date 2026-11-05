import type { BibListPosition } from './bib-list-position'

/** UI-only preview state, retained when reopening a file or project. */
export type BibPreviewSession = {
  entryId: string | null
  entryFrom: number | null
  listShown: boolean
  listPosition?: BibListPosition
}

export function bibPreviewSessionKey(projectId: string, documentId: string): string {
  return `bib-editor:preview:v1:${JSON.stringify([projectId, documentId])}`
}

export function readBibPreviewSession(key: string): BibPreviewSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (
      !value ||
      (value.entryId !== null && typeof value.entryId !== 'string') ||
      (value.entryFrom !== null && (!Number.isSafeInteger(value.entryFrom) || value.entryFrom < 0)) ||
      typeof value.listShown !== 'boolean' ||
      (value.listPosition !== undefined && (
        typeof value.listPosition?.entryId !== 'string' ||
        !Number.isFinite(value.listPosition.offset) ||
        !Number.isFinite(value.listPosition.scrollTop) ||
        value.listPosition.scrollTop < 0
      ))
    ) return null
    return value
  } catch {
    return null
  }
}

export function writeBibPreviewSession(key: string, state: BibPreviewSession): void {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Storage may be unavailable or disabled. The editor still works normally.
  }
}

export function resolveBibPreviewSession<T extends { from: number; entry: { id: string } }>(
  state: BibPreviewSession | null,
  entries: T[]
): { entry: T | null; listShown: boolean } {
  // A keyed ID must never resolve to a different entry at the same offset.
  // Keyless occurrence IDs can change when another keyless entry gets a key;
  // only those entries use source position as a fallback.
  const byId = state?.entryId
    ? entries.find(item => item.entry.id === state.entryId)
    : undefined
  const entry = state?.entryId && /^#\d+$/.test(state.entryId)
    ? entries.find(item => item.from === state.entryFrom) ?? byId ?? null
    : byId ?? null
  return { entry, listShown: entry ? state?.listShown ?? true : true }
}

/** One document-scoped cache shared by selection and scroll updates. */
export function createBibPreviewSessionStore(key: string) {
  let state: BibPreviewSession = readBibPreviewSession(key) ?? {
    entryId: null, entryFrom: null, listShown: true,
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!dirty) return
    writeBibPreviewSession(key, state)
    dirty = false
  }
  return {
    read: () => state,
    update(patch: Partial<BibPreviewSession>, deferred = false) {
      state = { ...state, ...patch }
      dirty = true
      if (!deferred) flush()
      else {
        clearTimeout(timer)
        timer = setTimeout(flush, 150)
      }
    },
    flush,
  }
}
