import { BibtexNameList } from '@shared/bibtex/bibtex-name.mts'
import { generateBaseCitationKey, pickAvailableKey } from '@/features/bibtex/citation-key'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import type { BibProjectedEntry } from './bib-entry-position'

const VALID_YEAR = /^\d{4}$/

/**
 * Generate a citation key even when the entry does not contain enough metadata
 * for the upstream generator. The visual editor deliberately uses deterministic
 * fallbacks instead of making the Generate button a no-op:
 *
 * - no usable author → `Unknown`
 * - no plain four-digit year (including a non-year date such as 2.2.2222) → `0000`
 */
export function generateCitationKey(entry: BibtexEntry): string {
  // Use upstream BibtexNameList interpretation and upstream key generation,
  // including its behavior for brace-protected organization names.
  const parsedAuthors = entry.getAuthors()
  const firstAuthor = parsedAuthors.names[0]
  const authors =
    firstAuthor && firstAuthor.toLast().trim() !== ''
      ? parsedAuthors
      : new BibtexNameList('Unknown')
  const rawYear = entry.getYear().trim()
  const year = VALID_YEAR.test(rawYear) ? rawYear : '0000'
  return generateBaseCitationKey({ authors, year })
}

/** Exclude one source occurrence for existing entries; new entries exclude none.
 * Duplicate source keys still participate in collision detection.
 */
export function pickAvailableKeyForEntry(
  base: string,
  existingKeys: readonly string[],
  sourceKey?: string
): string {
  const keys = [...existingKeys]
  const ownIndex = sourceKey === undefined ? -1 : keys.indexOf(sourceKey)
  if (ownIndex !== -1) keys.splice(ownIndex, 1)
  return pickAvailableKey(base, keys)
}

/** Generate a unique key using the same policy for every editor write path. */
export function generateAvailableCitationKey(
  entry: BibtexEntry,
  existingKeys: readonly string[],
  sourceKey?: string
): string {
  return pickAvailableKeyForEntry(generateCitationKey(entry), existingKeys, sourceKey)
}

/** Display-only suggestion. The source key remains empty until explicitly edited. */
export function displayCitationKey(
  entry: BibtexEntry,
  existingKeys: readonly string[]
): string {
  return entry.key || generateAvailableCitationKey(entry, existingKeys, '')
}

/** Commit a generated key only for a complete, keyless source entry.
 * Existing keyless entries remain unchanged until their Visual preview exits.
 */
export function keyToCommitOnLeave(
  sourceEntry: Pick<BibProjectedEntry, 'entry' | 'sourceFieldRanges'>,
  existingKeys: readonly string[],
  draft?: BibtexEntry
): string | null {
  const fields = sourceEntry.sourceFieldRanges
  if (!fields || new Set(fields.map(field => field.name)).size !== fields.length) {
    return null
  }
  const entry = sourceEntry.entry
  if (entry.key.trim() || draft?.key.trim()) return null
  return generateAvailableCitationKey(draft ?? entry, existingKeys, entry.key)
}
