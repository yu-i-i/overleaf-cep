/**
 * Pure validation for the bib visual editor.
 *
 * The preview and manual-entry modal use these messages for required fields,
 * invalid nonempty keys and non-blocking format warnings. Source syntax errors
 * and entry boundaries are handled separately by the Lezer-backed diagnostics.
 *
 * Rules used by this module:
 *  - empty citation keys are valid source; parsing never writes a key.
 *    Explicit Visual editing may generate one using the field-write path.
 *  - required fields: standalone "X is required"; OR-group "Either A or B is
 *    required" shown next to EVERY empty member of the group.
 *  - format warnings for filled values: year, date/URL date, DOI, URL.
 *    Format warnings do not block otherwise structurally safe writes.
 *
 * validateEntry() is pure: it returns machine-readable messages
 * (ValidationMessage), the view renders them via i18n.
 */
import { BIBTEX_CITATION_KEY_REGEX } from '@shared/bibtex/bibtex-identifier.mts'
import { missingRequiredFieldGroups } from './bib-types'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { fieldLabel } from './bib-field-labels'
import { isValidDoi } from './bib-doi'

export type ValidationMessage =
  | {
      kind: 'id-invalid'
    }
  | {
      /** One empty standalone required field, or a whole empty OR-group */
      kind: 'required-missing'
      /** Field member(s) this message applies to (standalone: 1) */
      labelFields: string[]
      group: boolean
    }
  | {
      kind: 'year-format'
    }
  | {
      kind: 'date-format'
    }
  | {
      kind: 'doi-format'
    }
  | {
      kind: 'url-invalid'
  }

/**
 * Match upstream BibTeX brace handling: every { and } is structural, even
 * after a backslash. A trailing backslash is ordinary field content.
 */
export function hasBalancedCurlyBraces(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '{') depth++
    else if (char === '}') {
      if (depth === 0) return false
      depth--
    }
  }
  return depth === 0
}

/** BibLaTeX date/date-range syntax, including partial dates and date-times. */
const DATE_PART_PATTERN = String.raw`(?:[+-]?\d{4}(?:-(?:\d{2}|XX)(?:-(?:\d{2}|XX)(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)?)?|\d{3}X|\d{2}XX)[?~%]?`
const DATE_PATTERN = new RegExp(
  String.raw`^(?:${DATE_PART_PATTERN}(?:\s*\/\s*(?:${DATE_PART_PATTERN}|\.\.))?|\.\.\s*\/\s*${DATE_PART_PATTERN})$`, 'i'
)

/** Validate the date syntax only; calendar and range ordering are not checked. */
function hasValidBiblatexDate(value: string): boolean {
  const date = value.trim()
  return !date || DATE_PATTERN.test(date)
}

const URL_PATTERN =
  /^(?:https?:\/\/)?(?:\[[\da-f:.]+\]|[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*\.?)(?::\d+)?(?:[/?#]\S*)?$/i

/** Validate URL syntax; an http(s) scheme is optional. */
function hasValidUrl(value: string): boolean {
  return URL_PATTERN.test(value.trim())
}

/** Empty keys are valid source and editable in the visual editor. */
export function isWritableCitationKey(key: string): boolean {
  // $ can match before a final newline in JavaScript, so compare the entire
  // match rather than treating RegExp.test() as a full-string assertion.
  return key === '' || BIBTEX_CITATION_KEY_REGEX.exec(key)?.[0] === key
}

export function hasUnbalancedCurlyBraces(entry: BibtexEntry): boolean {
  return entry
    .getFieldsArray()
    .some(({ value }) => !hasBalancedCurlyBraces(value.toEditableString()))
}

/** All format warnings are non-blocking; values are tested only if nonempty. */
const FORMAT_CHECKS: {
  field: string
  kind: 'year-format' | 'date-format' | 'doi-format' | 'url-invalid'
  valid: (value: string) => boolean
}[] = [
  { field: 'year', kind: 'year-format', valid: value => /^\d{4}$/.test(value.trim()) },
  { field: 'date', kind: 'date-format', valid: hasValidBiblatexDate },
  { field: 'urldate', kind: 'date-format', valid: hasValidBiblatexDate },
  { field: 'doi', kind: 'doi-format', valid: value => isValidDoi(value.trim()) },
  { field: 'url', kind: 'url-invalid', valid: hasValidUrl },
]

export type ValidationResult = {
  /** Validation messages keyed by field name (shown under each listed field) */
  byField: Record<string, ValidationMessage>
  /** True when there are no messages, including non-blocking warnings. */
  valid: boolean
}

/**
 * Validate an entry draft.
 *
 * An empty citation key is valid here. Generation/commit is managed by the
 * Visual editor's key-on-leave lifecycle, never by this validator.
 */
export function validateEntry(
  entry: BibtexEntry
): ValidationResult {
  const field = (name: string) => entry.getField(name).toEditableString()
  const key = entry.key
  const byField: Record<string, ValidationMessage> = {}

  if (!isWritableCitationKey(key)) {
    byField.id = { kind: 'id-invalid' }
  }

  // Attach one group error to each empty alternative so every input is marked.
  for (const members of missingRequiredFieldGroups(entry)) {
    const group = members.length > 1
    for (const f of members) {
      if (f in byField) continue
      byField[f] = {
        kind: 'required-missing',
        labelFields: members,
        group,
      }
    }
  }

  // Required-field errors take precedence over format-only warnings.
  for (const { field: name, kind, valid } of FORMAT_CHECKS) {
    const value = field(name)
    if (value.trim() && !byField[name] && !valid(value)) {
      byField[name] = { kind }
    }
  }

  return { byField, valid: Object.keys(byField).length === 0 }
}

const FORMAT_WARNING_KINDS = new Set<ValidationMessage['kind']>([
  'year-format',
  'date-format',
  'doi-format',
  'url-invalid',
])

export function isFormatWarning(
  message: ValidationMessage | undefined
): boolean {
  return message !== undefined && FORMAT_WARNING_KINDS.has(message.kind)
}

/** Return concise labels for non-blocking field-format warnings. */
export function formatWarningLabels(entry: BibtexEntry): string[] {
  return Object.entries(validateEntry(entry).byField)
    .filter(([, message]) => isFormatWarning(message))
    .map(([field]) => {
      if (field === 'doi') return 'DOI'
      return fieldLabel(field)
    })
}

/**
 * Format warnings do not block submission or source edits; required fields
 * and invalid nonempty citation keys are blocking for form submissions.
 * Structural source writes have separate Lezer-based guards.
 */
export function hasBlockingValidationErrors(result: ValidationResult): boolean {
  return Object.values(result.byField).some(
    message => !isFormatWarning(message)
  )
}
