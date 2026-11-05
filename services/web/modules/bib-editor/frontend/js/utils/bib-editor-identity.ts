/** Pure identity reconciliation for entry occurrences across CodeMirror edits. */
import type { ChangeSet } from '@codemirror/state'
import type { PositionedBibtexEntry } from './bib-types'
import type { BibEntryIdRemap } from './bib-editor-events'

export type PreviousBibEntryIdentity = {
  entryId: string
  from: number
  to: number
}

export type BibEntryIdentityChanges = {
  entryIdRemaps: BibEntryIdRemap[]
  removedEntryIds: string[]
  currentByPreviousId: Map<string, PositionedBibtexEntry>
}

/** Update citation-key occurrence indexes in document order. */
export function updateOccurrenceIndexes(entries: PositionedBibtexEntry[]) {
  const occurrenceIndexes = new Map<string, number>()
  for (const positioned of entries) {
    const key = positioned.entry.key
    const occurrenceIndex = occurrenceIndexes.get(key) ?? 0
    occurrenceIndexes.set(key, occurrenceIndex + 1)
    positioned.entry.occurrenceIndex = occurrenceIndex
  }
}

/** Nearest preceding entry, using sorted source offsets. */
export function nearestEntryAt(
  entries: PositionedBibtexEntry[],
  position: number
): PositionedBibtexEntry | undefined {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (entries[middle].from <= position) low = middle + 1
    else high = middle
  }
  return low > 0 ? entries[low - 1] : undefined
}

/** Match old occurrences to new ones using the source transaction mapping. */
export function getEntryIdentityChanges(
  changeset: ChangeSet,
  previousEntries: PreviousBibEntryIdentity[],
  nextEntries: PositionedBibtexEntry[]
): BibEntryIdentityChanges {
  const changes: Array<{
    fromA: number
    toA: number
    fromB: number
    toB: number
  }> = []
  changeset.iterChanges((fromA, toA, fromB, toB) => {
    changes.push({ fromA, toA, fromB, toB })
  })

  const currentByPreviousId = new Map<string, PositionedBibtexEntry>()
  const nextByStart = new Map(nextEntries.map(entry => [entry.from, entry] as const))
  const usedNext = new Set<PositionedBibtexEntry>()
  const handledPrevious = new Set<PreviousBibEntryIdentity>()
  const lowerBoundByStart = <T extends { from: number }>(items: T[], position: number) => {
    let low = 0
    let high = items.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (items[middle].from < position) low = middle + 1
      else high = middle
    }
    return low
  }
  const findCurrentAt = (position: number) => {
    const candidate = nextByStart.get(position)
    return candidate && !usedNext.has(candidate) ? candidate : undefined
  }

  const assign = (
    previous: PreviousBibEntryIdentity,
    current: PositionedBibtexEntry | undefined
  ) => {
    handledPrevious.add(previous)
    if (!current || usedNext.has(current)) return
    currentByPreviousId.set(previous.entryId, current)
    usedNext.add(current)
  }

  // If a transaction replaces a whole entry (or a larger source range), map
  // occurrences inside that range by document order. This distinguishes a
  // genuinely deleted entry from a following entry that happens to inherit
  // the deleted entry's old key#occurrenceIndex ID.
  for (const change of changes) {
    if (change.fromA === change.toA) continue
    const replaced: PreviousBibEntryIdentity[] = []
    for (
      let index = lowerBoundByStart(previousEntries, change.fromA);
      index < previousEntries.length && previousEntries[index].from < change.toA;
      index++
    ) {
      const entry = previousEntries[index]
      if (entry.to <= change.toA && !handledPrevious.has(entry)) {
        replaced.push(entry)
      }
    }
    if (replaced.length === 0) continue

    const inserted: PositionedBibtexEntry[] = []
    for (
      let index = lowerBoundByStart(nextEntries, change.fromB);
      index < nextEntries.length && nextEntries[index].from < change.toB;
      index++
    ) {
      const entry = nextEntries[index]
      if (entry.to <= change.toB && !usedNext.has(entry)) {
        inserted.push(entry)
      }
    }
    replaced.forEach((previous, index) => assign(previous, inserted[index]))
  }

  for (const previous of previousEntries) {
    if (handledPrevious.has(previous)) continue

    // Inserting directly at an entry's start moves the existing occurrence
    // after the inserted text. Replacing its start delimiter/key should map
    // to the replacement's start instead.
    const insertionAtStart = changes.some(change =>
      change.fromA === previous.from && change.toA === previous.from
    )
    const startReplaced = changes.some(change =>
      change.fromA < change.toA &&
      change.fromA <= previous.from &&
      previous.from < change.toA
    )
    const mappedFrom = changeset.mapPos(
      previous.from,
      insertionAtStart || !startReplaced ? 1 : -1
    )
    let current = findCurrentAt(mappedFrom)

    if (!current && startReplaced) {
      const mappedAfter = changeset.mapPos(previous.from, 1)
      current = findCurrentAt(mappedAfter)
    }

    assign(previous, current)
  }

  const entryIdRemaps: BibEntryIdRemap[] = []
  const removedEntryIds: string[] = []
  for (const previous of previousEntries) {
    const current = currentByPreviousId.get(previous.entryId)
    if (!current) {
      removedEntryIds.push(previous.entryId)
    } else if (current.entry.id !== previous.entryId) {
      entryIdRemaps.push({
        previousEntryId: previous.entryId,
        entryId: current.entry.id,
        from: current.from,
      })
    }
  }

  return { entryIdRemaps, removedEntryIds, currentByPreviousId }
}

