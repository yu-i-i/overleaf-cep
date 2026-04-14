/**
 * Lightweight BibTeX parser and serializer.
 * Parses a .bib file string into BibEntry objects and serializes them back.
 */
import type { BibEntry } from './bib-types'

/**
 * Parse a BibTeX source string into an array of entries.
 * Each entry includes its character offsets in the source for editing.
 */
export type ParsedBibEntry = BibEntry & {
  /** Start offset in the source string (inclusive) */
  sourceStart: number
  /** End offset in the source string (exclusive) */
  sourceEnd: number
  /** Raw source text for this entry */
  raw: string
}

/**
 * Parse all BibTeX entries from a source string.
 */
export function parseBibFile(source: string): ParsedBibEntry[] {
  const entries: ParsedBibEntry[] = []
  // Match @type{...} blocks, handling nested braces
  const entryStartRe = /@\s*([\w-]+)\s*\{/g
  let match: RegExpExecArray | null

  while ((match = entryStartRe.exec(source)) !== null) {
    const type = match[1].toLowerCase()
    // Skip @comment, @preamble, @string
    if (type === 'comment' || type === 'preamble' || type === 'string') {
      // Still need to skip past the braces
      const braceStart = match.index + match[0].length - 1
      const endIdx = findMatchingBrace(source, braceStart)
      if (endIdx !== -1) {
        entryStartRe.lastIndex = endIdx + 1
      }
      continue
    }

    const entrySourceStart = match.index
    const braceStart = match.index + match[0].length - 1
    const braceEnd = findMatchingBrace(source, braceStart)
    if (braceEnd === -1) continue

    const entrySourceEnd = braceEnd + 1
    const innerContent = source.slice(braceStart + 1, braceEnd)
    const raw = source.slice(entrySourceStart, entrySourceEnd)

    // Parse the id (citation key) - everything up to the first comma
    const commaIdx = innerContent.indexOf(',')
    if (commaIdx === -1) continue
    const id = innerContent.slice(0, commaIdx).trim()

    // Parse fields from the rest
    const fieldsStr = innerContent.slice(commaIdx + 1)
    const fields = parseFields(fieldsStr)

    entries.push({
      type,
      id,
      fields,
      sourceStart: entrySourceStart,
      sourceEnd: entrySourceEnd,
      raw,
    })

    entryStartRe.lastIndex = entrySourceEnd
  }

  return entries
}

/**
 * Parse a single BibTeX entry string (e.g., "@article{key, title={...}, ...}")
 */
export function parseBibEntry(source: string): BibEntry | null {
  const entries = parseBibFile(source)
  return entries.length > 0
    ? { type: entries[0].type, id: entries[0].id, fields: entries[0].fields }
    : null
}

/**
 * Find the index of the matching closing brace for the opening brace at `start`.
 */
function findMatchingBrace(source: string, start: number): number {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Parse "field = {value}" or "field = "value"" pairs from a fields string.
 */
function parseFields(fieldsStr: string): Record<string, string> {
  const fields: Record<string, string> = {}
  // Match field = {value} or field = "value" or field = number
  const fieldRe =
    /\b([\w-]+)\s*=\s*(?:\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}|"([^"]*)"|(\d+))/g
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(fieldsStr)) !== null) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    fields[name] = value.trim()
  }
  return fields
}

/**
 * Serialize a BibEntry to a BibTeX string.
 */
export function serializeBibEntry(entry: BibEntry): string {
  const escape = (s: string) => s.replace(/\}/g, '\\}')
  const lines: string[] = []
  for (const [key, value] of Object.entries(entry.fields)) {
    if (value && value.trim()) {
      lines.push(`  ${key} = {${escape(value.trim())}}`)
    }
  }
  return `@${entry.type}{${entry.id},\n${lines.join(',\n')}\n}`
}

/**
 * Replace a single entry's text in the full source.
 * Returns the updated source string.
 */
export function replaceEntryInSource(
  source: string,
  parsed: ParsedBibEntry,
  newEntry: BibEntry
): string {
  const newText = serializeBibEntry(newEntry)
  return source.slice(0, parsed.sourceStart) + newText + source.slice(parsed.sourceEnd)
}

/**
 * Remove an entry from the source, including trailing whitespace/newlines.
 */
export function removeEntryFromSource(
  source: string,
  parsed: ParsedBibEntry
): string {
  let end = parsed.sourceEnd
  // Consume trailing newlines
  while (end < source.length && (source[end] === '\n' || source[end] === '\r')) {
    end++
  }
  return source.slice(0, parsed.sourceStart) + source.slice(end)
}

/**
 * Generate a citation key from author/title/year fields.
 */
export function generateCitationKey(fields: Record<string, string>): string {
  const author = fields.author || ''
  const year = fields.year || ''
  const title = fields.title || ''

  // Extract first author's last name
  const authors = author.split(/\s+and\s+/i)
  const firstAuthor = authors[0] || ''
  const lastName = firstAuthor.includes(',')
    ? firstAuthor.split(',')[0].trim()
    : firstAuthor.split(/\s+/).pop() || ''

  const cleanLast = lastName.replace(/[^A-Za-z]/g, '')

  if (cleanLast) {
    return `${cleanLast}${year}`.toLowerCase()
  }

  // Fallback: first word of title + year
  const firstWord = title
    .split(/\s+/)[0]
    ?.replace(/[^A-Za-z0-9]/g, '')
    ?.toLowerCase()
  if (firstWord) {
    return `${firstWord}${year}`
  }

  // Last resort: random
  const chars = 'abcdefghijklmnopqrstuvwxyz'
  let rand = ''
  for (let i = 0; i < 6; i++) rand += chars[Math.floor(Math.random() * chars.length)]
  return `ref${rand}${year}`
}
