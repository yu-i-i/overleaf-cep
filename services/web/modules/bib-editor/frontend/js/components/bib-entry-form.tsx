/**
 * Shared form for editing a parsed entry or creating a new one. It emits draft
 * changes (including temporarily invalid input); the host decides when and
 * whether to commit them to CodeMirror. Abstract uses the same field model.
 */
import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { BIBTEX_IDENTIFIER_REGEX } from '@shared/bibtex/bibtex-identifier.mts'
import { getAllEntryTypes, getEntryType } from '@shared/bibtex/entry-types.mts'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import BibEntryFeedback from './bib-entry-feedback'
import {
  formRowsFor,
  getFieldType,
  isNameField,
  NAME_FIELDS,
  missingRequiredFieldGroups,
  optionalVisibleFor,
} from '../utils/bib-types'
import {
  OPTIONAL_FIELD_NAMES,
  offeredOptionalFields,
  requiredFieldNames,
} from '../utils/overleaf-type-map.ts'
import {
  hasBalancedCurlyBraces,
  hasBlockingValidationErrors,
  validateEntry,
  hasUnbalancedCurlyBraces,
  isFormatWarning,
  isWritableCitationKey,
} from '../utils/bib-validate'
import { helperKeyForField } from '../utils/bib-form-helper'
import { fieldLabel } from '../utils/bib-field-labels'
import { fromBibFormString, sameBibFormValue, toBibFormString } from '../utils/bib-field-edit'
import {
  createAuthorDraft,
  isAuthorDraftValid,
} from '../utils/bib-author-draft'
import type { BibAuthorDraft, BibNameDrafts } from '../utils/bib-author-draft'
import { generateAvailableCitationKey } from '../utils/bib-key-generation'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import type {
  BibFieldWriteTarget,
  BibFormChangeHandler,
  BibHistoryUserEvent,
} from '../context/bib-editor-context'

type Props = {
  /** The entry values the form starts from, including any unsaved local draft. */
  entry: BibtexEntry
  /** Invalid, source-preserving draft for each name-list field. */
  initialNameDrafts?: BibNameDrafts
  /** Authoritative parsed source value; differs from `entry` while a draft is invalid. */
  sourceEntry?: BibtexEntry
  /** Original editable spelling for multiline fields in the current source. */
  textareaSourceValues?: Record<string, string>
  kind: 'existing' | 'new'
  /** IDs of all existing entries (citation-key collision hints) */
  existingIds?: string[]
  /** Receives every draft edit, including locally retained invalid values. */
  onFormChange: BibFormChangeHandler
  /** Called when the host's primary action is pressed after validation. */
  onChecked?: (
    entry: BibtexEntry,
    kind: 'existing' | 'new'
  ) => void | Promise<boolean>
  /** In previews, render Abstract in its own tab using the same field editor. */
  previewTab?: 'details' | 'abstract'
  /** Switch the preview host to its dedicated Abstract tab. */
  onSelectAbstract?: () => void
  /** Prefix for DOM ids when more than one form can be mounted. */
  idPrefix?: string
  /** Optional section shared across entries while the current BibTeX file is open. */
  optionalExpanded?: boolean
  onOptionalExpandedChange?: (expanded: boolean) => void
  /** Incremented when undo/redo requires discarding this entry's local draft. */
  draftReset?: { version: number }
  /** Disable the primary action while the host is saving. */
  submitDisabled?: boolean
  /** Supplies the modal host with the current submit action and disabled state. */
  onFooterStateChange?: (state: { disabled: boolean; submit: () => void }) => void
}

import { BibEntryTypeCombobox, BibAddFieldCombobox, displayCustomType } from './bib-entry-form-comboboxes'
import BibNameField, { resizeTextarea } from './bib-name-field'

const ENTRY_TYPES = getAllEntryTypes()

type SubmissionBlockers = {
  kind: Props['kind']
  submitDisabled: boolean
  unbalancedCurlyBraces: boolean
  hasPendingStructuralErrors: boolean
  validationResult: ReturnType<typeof validateEntry>
}

function shouldBlockSubmission({
  kind,
  submitDisabled,
  unbalancedCurlyBraces,
  hasPendingStructuralErrors,
  validationResult,
}: SubmissionBlockers): boolean {
  return (
    submitDisabled ||
    unbalancedCurlyBraces ||
    (kind === 'new' && (
      hasPendingStructuralErrors ||
      hasBlockingValidationErrors(validationResult)
    ))
  )
}

export default function BibEntryForm({
  entry,
  initialNameDrafts,
  sourceEntry = entry,
  textareaSourceValues,
  kind,
  existingIds = [],
  onFormChange,
  onChecked,
  submitDisabled = false,
  onFooterStateChange,
  onSelectAbstract,
  previewTab,
  idPrefix = '',
  draftReset,
  optionalExpanded: sharedOptionalExpanded,
  onOptionalExpandedChange,
}: Props) {
  const { t } = useTranslation()
  // This set initializes a ref; changing props must not reset validation of
  // the user's in-progress name rows. Compute it only on the first render.
  const [initiallyInvalidNameFields] = useState(() => NAME_FIELDS.filter(field =>
    !isAuthorDraftValid(
      initialNameDrafts?.[field] ??
        createAuthorDraft(toBibFormString(entry.getField(field), field))
    )
  ))
  const [draft, setDraft] = useState(entry)
  const draftRef = useRef(entry)
  // BibtexFieldValue.toEditableString() uses canonical escaping (e.g. # -> ##).
  // Do not replace the user's input mid-edit: an incomplete #name can become a
  // named string once its closing # is typed. Keep raw text while the parsed
  // field value still matches what this input last produced.
  const fieldInputRef = useRef(
    new Map<string, { text: string; canonical: string }>()
  )
  const [entryTypeSelected, setEntryTypeSelected] = useState(kind !== 'new')
  const type = draft.type || 'article'
  const id = draft.key || ''
  // Previews share this state per open file; standalone forms own it locally.
  const [localOptionalExpanded, setLocalOptionalExpanded] = useState(false)
  const optionalExpanded = sharedOptionalExpanded ?? localOptionalExpanded
  const setOptionalExpanded = onOptionalExpandedChange ?? setLocalOptionalExpanded
  const [checked, setChecked] = useState(false)
  // Optional controls remain mounted after their value is cleared. They disappear
  // only when this form instance is recreated (for example, after reopening).
  const [visibleOptionals, setVisibleOptionals] = useState<string[]>(() =>
    optionalVisibleFor(type, entry)
  )
  const [removedOptionals, setRemovedOptionals] = useState<string[]>([])
  // Each name-list row is validated separately: concatenating two malformed
  // rows could otherwise accidentally produce balanced braces.
  const pendingInvalidFieldsRef = useRef(new Set<string>(initiallyInvalidNameFields))
  const nameDraftValid = (field: string) =>
    !pendingInvalidFieldsRef.current.has(field)

  // `draft` is the form's editable projection, not a second document. CodeMirror
  // remains authoritative. A local draft can temporarily
  // contain an invalid key or unmatched braces while the user is typing, but such
  // a draft must not be serialized over the original source because doing so would
  // discard text the visual parser could not represent.
  const reportDraft = useCallback(
    (
      next: BibtexEntry,
      historyUserEvent: BibHistoryUserEvent = 'input.type',
      fieldName?: string,
      fieldIsValid = true,
      fieldTarget?: BibFieldWriteTarget,
      nameDraft?: BibAuthorDraft
    ) => {
      draftRef.current = next
      setDraft(next)

      // Validate the edited target separately from the whole draft: a field edit
      // is allowed while the citation key or another field is temporarily invalid.
      const citationKeyIsWritable = isWritableCitationKey(next.key)
      const draftHasUnbalancedBraces = hasUnbalancedCurlyBraces(next)

      // Keep invalid state keyed by a stable field name so it can be merged back
      // into the parsed source entry when CodeMirror updates behind this form.
      let fieldKey = fieldName ?? 'entry'
      let targetValueIsValid: boolean
      switch (fieldTarget?.kind) {
        case 'field':
          fieldKey = fieldTarget.name
          targetValueIsValid = hasBalancedCurlyBraces(
            next.getField(fieldTarget.name).toEditableString()
          )
          break
        case 'citation-key':
          fieldKey = 'id'
          targetValueIsValid = citationKeyIsWritable
          break
        case 'entry-type':
          fieldKey = 'entry-type'
          targetValueIsValid = true
          break
        default:
          targetValueIsValid = citationKeyIsWritable && !draftHasUnbalancedBraces
      }
      const targetIsValid = fieldIsValid && targetValueIsValid

      if (targetIsValid) pendingInvalidFieldsRef.current.delete(fieldKey)
      else pendingInvalidFieldsRef.current.add(fieldKey)

      // The draft is safe to materialize when its key is either empty or valid,
      // braces are balanced, and no structurally invalid field edits remain.
      const draftIsValid =
        citationKeyIsWritable &&
        !draftHasUnbalancedBraces &&
        pendingInvalidFieldsRef.current.size === 0

      // Keep the entire draft in the parent even when it cannot yet be written
      // to CodeMirror. The parent uses the target validity to gate this source
      // mutation while retaining the full draft across remounts.
      onFormChange(
        next,
        historyUserEvent,
        targetIsValid,
        fieldTarget,
        draftIsValid,
        nameDraft
      )
    },
    [onFormChange]
  )

  // The preview remounts per entry identity, so selecting another entry
  // creates a fresh form instance. Within one occurrence, the
  // parsed entry remains the source of truth: if the document changes behind
  // the form and the local draft no longer matches it, restore the parsed entry.
  const parsedSignatureRef = useRef(entry.toString())
  const draftResetVersionRef = useRef(draftReset?.version ?? 0)
  useEffect(() => {
    const nextSignature = entry.toString()
    const parsedChanged = nextSignature !== parsedSignatureRef.current
    const resetDraft =
      draftReset != null && draftReset.version !== draftResetVersionRef.current
    parsedSignatureRef.current = nextSignature
    if (draftReset) draftResetVersionRef.current = draftReset.version
    if (!parsedChanged && !resetDraft) return

    // Invalid local values were never written to CodeMirror, so they cannot be
    // represented in its undo history. On undo/redo, reset this form to the
    // authoritative source entry instead of letting those values mask history.
    if (resetDraft) {
      pendingInvalidFieldsRef.current.clear()
      fieldInputRef.current.clear()
      draftRef.current = entry
      setDraft(entry)
      setChecked(false)
      setRemovedOptionals([])
      return
    }

    // A source edit from outside this form takes precedence over locally
    // preserved input spelling. Local writes retain the same canonical value.
    for (const [field, input] of fieldInputRef.current) {
      if (!sameBibFormValue(input.canonical, toBibFormString(entry.getField(field), field))) {
        fieldInputRef.current.delete(field)
      }
    }

    if (draftRef.current.toString() === nextSignature) {
      return
    }

    let merged = entry
    const localDraft = draftRef.current
    for (const field of pendingInvalidFieldsRef.current) {
      if (field === 'id') {
        merged = merged.setKey(localDraft.key)
      } else if (field === 'entry-type') {
        merged = merged.setType(localDraft.type)
      } else if (field !== 'entry' && localDraft.hasField(field)) {
        merged = merged.setField(field, localDraft.getField(field))
      } else if (field !== 'entry') {
        merged = merged.deleteField(field)
      }
    }
    draftRef.current = merged
    setDraft(merged)
    setChecked(false)
    // Intentionally exclude `draft`: it is local form state and must not make
    // this synchronization effect run after every keystroke.
  }, [entry, sourceEntry, kind, draftReset])

  const entryTypeDef = getEntryType(type.toLowerCase())

  // Pure validation feeds live format warnings in the preview and submit-time
  // errors in the manual-entry modal. Required-field stars are independent.
  const starMembers = new Set(missingRequiredFieldGroups(draft).flat())

  const validationResult = useMemo(() => validateEntry(draft), [draft])
  const sourceValidationResult = useMemo(() => validateEntry(sourceEntry), [sourceEntry])
  const checkResult = checked ? validationResult : null

  const unbalancedCurlyBraces =
    hasUnbalancedCurlyBraces(draft) ||
    NAME_FIELDS.some(field => !nameDraftValid(field))

  // Preserve the order defined by the selected shared entry type.
  const fieldRows = useMemo(() => formRowsFor(type), [type])

  // Source updates may add fields while the form stays mounted. Merge those
  // into the openable set without closing optionals the user previously added.
  useEffect(() => {
    const currentlyPopulated = optionalVisibleFor(type, entry).filter(
      field => !removedOptionals.includes(field)
    )
    if (currentlyPopulated.length === 0) return
    setVisibleOptionals(previous => {
      const next = [...previous]
      for (const field of currentlyPopulated) {
        if (!next.includes(field)) next.push(field)
      }
      return next.length === previous.length ? previous : next
    })
  }, [type, entry, removedOptionals])

  const optionalRows = useMemo(
    () => optionalVisibleFor(type, draft, visibleOptionals),
    [type, draft, visibleOptionals]
  )
  const pendingOptionalFocusRef = useRef<string | null>(null)

  // The input for an added optional field exists only after React renders it.
  useEffect(() => {
    const field = pendingOptionalFocusRef.current
    if (!field || !optionalRows.includes(field)) return

    pendingOptionalFocusRef.current = null
    const raf = requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}${field}`)?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [optionalRows])

  // Expand Optional to expose structural errors or format warnings. A syntax
  // error takes precedence over a format warning in the same field.
  const hasInvalidOptionalField = optionalRows.some(fieldName => {
    if (!hasBalancedCurlyBraces(toBibFormString(draft.getField(fieldName), fieldName))) {
      return true
    }
    const sourceMessage = !draft.hasField(fieldName)
      ? sourceValidationResult.byField[fieldName]
      : undefined
    return isFormatWarning(validationResult.byField[fieldName] ?? sourceMessage)
  })

  useEffect(() => {
    if (hasInvalidOptionalField) setOptionalExpanded(true)
  }, [hasInvalidOptionalField])

  const offeredFields = useMemo(
    () =>
      offeredOptionalFields(entryTypeDef).filter(
        field =>
          !optionalRows.includes(field) &&
          !fieldRows.includes(field)
      ),
    [entryTypeDef, optionalRows, fieldRows]
  )

  const standardFieldNames = useMemo(() => {
    const names = new Set<string>([
      ...fieldRows,
      ...OPTIONAL_FIELD_NAMES,
      ...requiredFieldNames(entryTypeDef),
    ])
    return Array.from(names)
  }, [fieldRows, entryTypeDef.requiredFields])

  const existingFieldNames = useMemo(
    () => draft.getFieldsArray().map(({ key }) => key),
    [draft]
  )

  const handleFieldChange = useCallback(
    (
      name: string,
      value: string,
      historyUserEvent: BibHistoryUserEvent = 'input.type',
      fieldIsValid = true,
      nameDraft?: BibAuthorDraft
    ) => {
      const current = draftRef.current
      const next = (getFieldType(name) === 'large' ? value !== '' : value.trim() !== '')
        ? current.setField(
            name,
            fromBibFormString(value, name, current.getField(name))
          )
        : current.deleteField(name)
      // Validate the exact input text before conversion to BibtexFieldValue.
      // The editable and serialized representations can differ, so checking
      // only the converted value can miss malformed braces.
      // Name-list controls validate individual rows themselves.
      const isName = isNameField(name)
      const rawValueIsValid =
        fieldIsValid && (isName || hasBalancedCurlyBraces(value))
      if (!isName) {
        const canonical = toBibFormString(next.getField(name), name)
        if (canonical === value) fieldInputRef.current.delete(name)
        else fieldInputRef.current.set(name, { text: value, canonical })
      }
      reportDraft(
        next, historyUserEvent, name, rawValueIsValid,
        { kind: 'field', name }, nameDraft
      )
    },
    [reportDraft]
  )

  const handleGenerateKey = useCallback((focusAfter: boolean) => {
    const current = draftRef.current
    // Existing entries may reuse their own source key; new entries may not.
    const key = generateAvailableCitationKey(
      current, existingIds, kind === 'new' ? undefined : sourceEntry.key
    )
    reportDraft(current.setKey(key), 'input.complete', 'id', true, { kind: 'citation-key' })
    if (focusAfter) {
      requestAnimationFrame(() => {
        document.getElementById(`${idPrefix}ref-key`)?.focus()
      })
    }
  }, [existingIds, idPrefix, kind, reportDraft, sourceEntry.key])

  const hasPendingStructuralErrors = pendingInvalidFieldsRef.current.size > 0
  const submissionBlocked =
    (kind === 'new' && !entryTypeSelected) ||
    shouldBlockSubmission({
      kind,
      submitDisabled,
      unbalancedCurlyBraces,
      hasPendingStructuralErrors,
      validationResult,
    })

  const handleCheck = useCallback(() => {
    const current = draftRef.current
    setChecked(true)

    // Use the same blockers as the disabled Save button. Format warnings do
    // not block submission; the host generates a key if the new entry has none.
    const blocked =
      (kind === 'new' && !entryTypeSelected) ||
      shouldBlockSubmission({
        kind,
        submitDisabled,
        unbalancedCurlyBraces:
          hasUnbalancedCurlyBraces(current) ||
          NAME_FIELDS.some(field => pendingInvalidFieldsRef.current.has(field)),
        hasPendingStructuralErrors: pendingInvalidFieldsRef.current.size > 0,
        validationResult: validateEntry(current),
      })
    if (blocked) return Promise.resolve(false)

    return Promise.resolve(onChecked?.(current, kind)).then(result =>
      result === undefined ? true : result
    )
  }, [entryTypeSelected, kind, onChecked, submitDisabled])

  // The modal footer is outside this form. Publish the current submit action
  // only after validation or the save-disabled state changes.
  useEffect(() => {
    onFooterStateChange?.({
      disabled: submissionBlocked,
      submit: () => { void handleCheck() },
    })
  }, [handleCheck, onFooterStateChange, submissionBlocked])

  const handleTypeChange = useCallback(
    (name: string) => {
      const nextEntry = draftRef.current.setType(name)
      reportDraft(nextEntry, 'input.complete', 'type', true, { kind: 'entry-type' })
      setEntryTypeSelected(true)
      setChecked(false)
      setVisibleOptionals([])
    },
    [reportDraft]
  )

  const handleAddOptional = useCallback((field: string) => {
    const normalized = field.trim().toLowerCase()
    if (!BIBTEX_IDENTIFIER_REGEX.test(normalized)) return

    setRemovedOptionals(previous => previous.filter(name => name !== normalized))
    pendingOptionalFocusRef.current = normalized
    setVisibleOptionals(prev =>
      prev.includes(normalized) ? prev : [...prev, normalized]
    )
  }, [])

  const handleRemoveOptional = useCallback((field: string) => {
    fieldInputRef.current.delete(field)
    setRemovedOptionals(previous =>
      previous.includes(field) ? previous : [...previous, field]
    )
    setVisibleOptionals(previous => previous.filter(name => name !== field))
    reportDraft(
      draftRef.current.deleteField(field),
      'delete',
      field,
      true,
      { kind: 'field', name: field }
    )
  }, [reportDraft])

  const selectedType = ENTRY_TYPES.find(et => et.key === type)

  const validationMessageText = (
    fieldName: string,
    msg: ReturnType<typeof validateEntry>['byField'][string]
  ): string | null => {
    switch (msg.kind) {
      case 'required-missing': {
        if (msg.group && msg.labelFields.length > 1) {
          const labels = msg.labelFields.map(field => fieldLabel(field))
          return t('either_a_or_b_is_required', {
            a: labels.slice(0, -1).join(', ') + (labels.length > 2 ? ',' : ''),
            b: labels[labels.length - 1],
          })
        }
        return t('field_is_required', { a: fieldLabel(fieldName) })
      }
      case 'id-invalid':
        return t('citation_key_contains_invalid_characters')
      case 'year-format':
        return t('year_format_hint')
      case 'date-format':
        return t('date_format_hint')
      case 'doi-format':
        return t('doi_format_hint')
      case 'url-invalid':
        return t('url_format_hint')
      default:
        return null
    }
  }

  // Invalid citation-key characters are an immediate field error, like
  // unbalanced braces.
  const invalidCitationKeyMessage =
    validationResult.byField.id?.kind === 'id-invalid'
      ? validationResult.byField.id
      : undefined
  const keyMessage =
    invalidCitationKeyMessage ??
    (kind === 'new' ? checkResult?.byField.id : undefined)
  const citationKeyMessage = keyMessage
    ? validationMessageText('id', keyMessage)
    : null

  // Format warnings are live in both hosts. The modal reveals missing-field
  // messages after a submit attempt, while invalid citation-key characters are
  // reported immediately.
  //   standalone missing → "<Label> is required"
  //   OR-group missing   → "Either A or B is required" (one per empty member)
  const messageFor = (fieldName: string): string | null => {
    // Syntax errors take priority only within their own field. Citation keys
    // are validated as identifiers and must never receive brace/backslash errors.
    const fieldHasSyntaxError =
      isNameField(fieldName)
        ? !nameDraftValid(fieldName)
        : !hasBalancedCurlyBraces(
            draft.getField(fieldName).toEditableString()
          )
    if (fieldHasSyntaxError) return null

    let msg: ReturnType<typeof validateEntry>['byField'][string] | undefined
    if (kind === 'existing') {
      msg = validationResult.byField[fieldName]
      // Keep a source warning visible if deleting a field was rejected.
      if (!msg && !draft.hasField(fieldName)) {
        msg = sourceValidationResult.byField[fieldName]
      }
      if (msg?.kind !== 'required-missing' && !isFormatWarning(msg)) return null
    } else {
      msg = validationResult.byField[fieldName]
      if (!checkResult && !isFormatWarning(msg)) return null
    }
    if (!msg) {
      return null
    }
    return validationMessageText(fieldName, msg)
  }

  // Helper text is deliberately centralized in bib-form-helper.ts. Some fields
  // have no helper at all; in particular, Author/Editor stay visually quiet.
  const rowHelper = (fieldName: string): string | null => {
    const key = helperKeyForField(fieldName)
    return key ? t(key) : null
  }

  // Focus structural field errors before citation-key problems, then other
  // validation warnings. Clean existing entries must not steal focus.
  const focusOnceRef = useRef(false)
  useLayoutEffect(() => {
    if (focusOnceRef.current || (kind === 'new' && !entryTypeSelected)) return

    const fields = [...fieldRows, ...optionalRows]
    const firstStructuralField = fields.find(fieldName =>
      isNameField(fieldName)
        ? !nameDraftValid(fieldName)
        : !hasBalancedCurlyBraces(
            toBibFormString(draft.getField(fieldName), fieldName)
          )
    )
    const key = sourceEntry.key.trim()
    const duplicateKey =
      kind === 'existing' &&
      key !== '' &&
      existingIds.filter(existingKey => existingKey.trim() === key).length > 1
    const keyNeedsFocus = duplicateKey || validationResult.byField.id != null
    const firstWrongField =
      firstStructuralField ??
      (keyNeedsFocus
        ? undefined
        : fields.find(fieldName =>
            validationResult.byField[fieldName] != null ||
            (!draft.hasField(fieldName) &&
              sourceValidationResult.byField[fieldName] != null)
          ))

    if (firstWrongField && optionalRows.includes(firstWrongField) && !optionalExpanded) {
      setOptionalExpanded(true)
      return
    }

    const targetId = firstWrongField
      ? `${idPrefix}${firstWrongField}`
      : keyNeedsFocus || kind === 'new'
        ? `${idPrefix}ref-key`
        : null

    // Focus is decided only once per form instance. Later edits must not
    // move focus away from the field the user is editing.
    focusOnceRef.current = true
    if (targetId) document.getElementById(targetId)?.focus()
  }, [
    draft,
    entryTypeSelected,
    fieldRows,
    idPrefix,
    existingIds,
    optionalExpanded,
    optionalRows,
    sourceEntry.key,
    sourceValidationResult,
    validationResult,
    kind,
  ])

  // Ordinary fields show their own brace warning. Author and Editor validate
  // their name inputs individually, so they render feedback inside the control.
  const renderField = (fieldName: string) => {
    const isAbstractPreview = previewTab !== undefined && fieldName === 'abstract'
    const isStarred = starMembers.has(fieldName)
    const isOptional = optionalRows.includes(fieldName)
    const message = messageFor(fieldName)
    const helper = rowHelper(fieldName)
    const canonical = toBibFormString(draft.getField(fieldName), fieldName)
    const typeOfField = getFieldType(fieldName)
    const input = fieldInputRef.current.get(fieldName)
    const value = input && sameBibFormValue(input.canonical, canonical)
      ? input.text
      : typeOfField === 'large' &&
          sourceEntry.getField(fieldName).toEditableString() === canonical
        ? textareaSourceValues?.[fieldName] ?? canonical
        : canonical
    const unbalanced = !hasBalancedCurlyBraces(value)
    const braceFeedback = typeOfField !== 'name' && unbalanced && (
      <BibEntryFeedback message={t('curly_braces_must_be_balanced')} />
    )
    const messageFeedback = message && (
      <BibEntryFeedback message={message} variant="warning" />
    )
    const fieldControl = typeOfField === 'name' ? (
      <BibNameField
        key={draftReset?.version ?? 0}
        fieldName={fieldName}
        value={value}
        initialDraft={initialNameDrafts?.[fieldName]}
        onChange={(val, historyUserEvent, fieldIsValid, nameDraft) =>
          handleFieldChange(fieldName, val, historyUserEvent, fieldIsValid, nameDraft)
        }
        error={!!message}
        idPrefix={idPrefix}
      />
    ) : typeOfField === 'large' ? (
      <OLFormControl
        as="textarea"
        ref={isAbstractPreview ? undefined : resizeTextarea}
        id={`${idPrefix}${fieldName}`}
        className={`${isOptional ? 'bibtex-form-input ' : ''}${
          fieldName === 'abstract' ? 'bibtex-abstract-textarea' : ''
        } ${message || unbalanced ? 'is-invalid' : ''}`}
        maxLength={fieldName === 'abstract' ? '8192' : '4096'}
        autoComplete="off"
        value={value}
        onChange={e => handleFieldChange(fieldName, e.target.value)}
        onInput={isAbstractPreview ? undefined : event => {
          resizeTextarea(event.currentTarget)
        }}
        rows={isAbstractPreview ? 18 : 1}
      />
    ) : (
      <OLFormControl
        id={`${idPrefix}${fieldName}`}
        className={`${isOptional ? 'bibtex-form-input ' : ''}${
          message || unbalanced ? 'is-invalid' : ''
        }`}
        maxLength="512"
        type="text"
        value={value}
        onChange={e => handleFieldChange(fieldName, e.target.value)}
      />
    )

    return (
      <div
        className={isAbstractPreview ? 'form-group bibtex-abstract-form-group' : 'form-group'}
        key={fieldName}
      >
        <OLFormLabel
          className={isAbstractPreview ? 'visually-hidden' : undefined}
          htmlFor={`${idPrefix}${fieldName}`}
        >
          {fieldLabel(fieldName)}
          {isStarred && (
            <span className="bibtex-form-required"> *</span>
          )}
        </OLFormLabel>
        {isOptional ? (
          <div className="bibtex-field-with-actions bibtex-optional-field-row">
            {fieldControl}
            {braceFeedback}
            {messageFeedback}
            <div className="bibtex-form-actions">
              <OLIconButton
                icon="close"
                variant="ghost"
                unfilled
                accessibilityLabel={t('remove_field', { a: fieldLabel(fieldName) })}
                onMouseDown={event => event.preventDefault()}
                onClick={() => handleRemoveOptional(fieldName)}
              />
            </div>
          </div>
        ) : (
          <>
            {fieldControl}
            {braceFeedback}
          </>
        )}
        {helper && <OLFormText>{helper}</OLFormText>}
        {!isOptional && messageFeedback}
      </div>
    )
  }

  const detailsContent = (
    <>
      <OLFormGroup>
        <OLFormLabel htmlFor={`${idPrefix}ref-type`}>
          {t('entry_type')}
        </OLFormLabel>
        <BibEntryTypeCombobox
          id={`${idPrefix}ref-type`}
          selected={
            entryTypeSelected ? selectedType?.label ?? displayCustomType(type) : ''
          }
          currentType={entryTypeSelected ? type : ''}
          entryTypes={ENTRY_TYPES}
          onSelect={handleTypeChange}
        />
      </OLFormGroup>
      {kind === 'new' && !entryTypeSelected ? (
        <OLFormText>{t('select_a_type_to_see_the_required_fields')}</OLFormText>
      ) : (
        <div>

        <OLFormGroup>
          <OLFormLabel htmlFor={`${idPrefix}ref-key`}>
            {t('citation_key')}
          </OLFormLabel>
          <div className="bibtex-field-with-actions">
            <OLFormControl
              className={`bibtex-form-input ${
                citationKeyMessage ? 'is-invalid' : ''
              }`}
              maxLength="128"
              autoComplete="off"
              type="text"
              id={`${idPrefix}ref-key`}
              value={id}
              onChange={e => {
                // Existing Visual entries keep an empty source key until the
                // preview closes. The displayed suggestion is only a placeholder.
                const key = kind === 'new' && !e.target.value.trim()
                  ? generateAvailableCitationKey(draftRef.current, existingIds)
                  : e.target.value
                reportDraft(
                  draftRef.current.setKey(key),
                  'input.type',
                  'id',
                  true,
                  { kind: 'citation-key' }
                )
              }}
              placeholder={id ? 'e.g. Doe0000' : generateAvailableCitationKey(
                draft, existingIds, kind === 'new' ? undefined : sourceEntry.key
              )}
            />
            {citationKeyMessage && (
              <BibEntryFeedback message={citationKeyMessage} />
            )}
            <div className="bibtex-form-actions">
              <OLButton
                variant="secondary"
                size="sm"
                onMouseDown={event => event.preventDefault()}
                onClick={() => handleGenerateKey(true)}
              >
                {t('generate')}
              </OLButton>
            </div>
          </div>
          <OLFormText>{t('citation_key_autogenerate_helper')}</OLFormText>
        </OLFormGroup>

        {/* Keep the entry type's defined field order; it is not alphabetical. */}
        {fieldRows.filter(field => previewTab === undefined || field !== 'abstract').map(renderField)}

        {/* Optional fields are hidden until requested, except validation can force the
            section open when a hidden field contains unbalanced braces. */}
        <div className="ms-2">
          <button
            type="button"
            className="bibtex-collapsible-heading"
            aria-expanded={optionalExpanded}
            aria-label={
              optionalExpanded ? t('collapse_optional') : t('expand_optional')
            }
            onClick={() => setOptionalExpanded(!optionalExpanded)}
          >
            <span className="mb-0 form-label">{t('optional')}</span>
            <span className="material-symbols bibtex-collapsible-heading-icon" aria-hidden="true" translate="no">
              {optionalExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
            </span>
          </button>
        {optionalExpanded && (
          <div className="position-relative">
            {optionalRows.filter(field => previewTab === undefined || field !== 'abstract').map(renderField)}
              <BibAddFieldCombobox
                placeholder={t('enter_field_name')}
                offered={offeredFields}
                standardFields={standardFieldNames}
                existingFields={existingFieldNames}
                onSelect={field => {
                  if (field === 'abstract' && onSelectAbstract) {
                    onSelectAbstract()
                    return
                  }
                  handleAddOptional(field)
                }}
              />
          </div>
        )}
        </div>
        </div>
      )}
    </>
  )

  if (!previewTab) return detailsContent

  return (
    <>
      <div
        hidden={previewTab !== 'details'}
        role="tabpanel"
        id={`${idPrefix}panel-details`}
        aria-labelledby={`${idPrefix}tab-details`}
      >
        {detailsContent}
      </div>
      <div
        hidden={previewTab !== 'abstract'}
        role="tabpanel"
        id={`${idPrefix}panel-abstract`}
        aria-labelledby={`${idPrefix}tab-abstract`}
      >
        {renderField('abstract')}
      </div>
    </>
  )
}
