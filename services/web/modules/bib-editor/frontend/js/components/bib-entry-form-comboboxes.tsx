/** Entry-type and optional-field pickers, independent of draft and save state. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { BIBTEX_IDENTIFIER_REGEX } from '@shared/bibtex/bibtex-identifier.mts'
import { getAllEntryTypes } from '@shared/bibtex/entry-types.mts'
import OLButton from '@/shared/components/ol/ol-button'
import OLAutocomplete from '@/shared/components/ol/ol-autocomplete'
import MaterialIcon from '@/shared/components/material-icon'
import { NON_BIBLIOGRAPHY_ENTRY_TYPES } from '../utils/bib-constants'
import { OPTIONAL_FIELD_TAXONOMY } from '../utils/overleaf-type-map.ts'
import { fieldGroupLabel } from '../utils/bib-field-labels'

export const displayCustomType = (type: string) =>
  type.charAt(0).toUpperCase() + type.slice(1)

/** Keep a fixed-position combobox aligned with its trigger while open. */
function useTrackMenuPosition(
  open: boolean,
  updatePosition: () => void,
  menuRef?: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!open) return
    const onScroll = (event: Event) => {
      // Scrolling the dropdown itself should not reposition its trigger.
      if (event.target instanceof Node && menuRef?.current?.contains(event.target)) return
      updatePosition()
    }
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, updatePosition, menuRef])
}

/** Searchable entry-type picker using the same autocomplete as Add field. */
export function BibEntryTypeCombobox({
  id,
  selected,
  currentType,
  entryTypes,
  onSelect,
}: {
  id: string
  selected: string
  currentType: string
  entryTypes: ReturnType<typeof getAllEntryTypes>
  onSelect: (type: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{
    left: number
    width: number
    top?: number
    bottom?: number
  } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const spaceBelow = window.innerHeight - rect.bottom
    const expandUp = spaceBelow < 360 && rect.top > spaceBelow
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(expandUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setPosition(null)
  }, [])

  useLayoutEffect(() => {
    if (open && position) inputRef.current?.focus()
  }, [open])

  useTrackMenuPosition(open, updatePosition, menuRef)

  const select = useCallback((name: string) => {
    const type = name.trim().toLowerCase()
    if (!BIBTEX_IDENTIFIER_REGEX.test(type)) return
    if (NON_BIBLIOGRAPHY_ENTRY_TYPES.has(type)) return
    onSelect(type)
    close()
  }, [close, onSelect])

  const canCreate = useCallback((name: string) => {
    const type = name.trim().toLowerCase()
    return BIBTEX_IDENTIFIER_REGEX.test(type) &&
      !NON_BIBLIOGRAPHY_ENTRY_TYPES.has(type) &&
      type !== currentType &&
      !entryTypes.some(entryType => entryType.key === type)
  }, [currentType, entryTypes])

  return (
    <div
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          close()
        }
      }}
    >
      <button
        id={id}
        ref={buttonRef}
        type="button"
        className="form-control text-start d-flex justify-content-between align-items-center w-100 entry-type-selector-btn"
        onClick={() => {
          if (open) close()
          else {
            updatePosition()
            setOpen(true)
          }
        }}
      >
        <span>{selected || t('select')}</span>
        <MaterialIcon type="keyboard_arrow_down" />
      </button>
      {open && position && (
        <div
          ref={menuRef}
          className={`button-autocomplete-container position-fixed rounded-1 shadow p-2${position.bottom !== undefined ? ' expand-up' : ''}`}
          style={position}
        >
          <OLAutocomplete
            items={[
              ...entryTypes.map(entryType => ({
                value: entryType.key,
                label: entryType.label,
              })),
              ...(currentType && !entryTypes.some(entryType => entryType.key === currentType)
                ? [{ value: currentType, label: displayCustomType(currentType) }]
                : []),
            ]}
            onChange={select}
            placeholder={t('enter_type')}
            label={t('entry_type')}
            showLabel={false}
            isOpen={open}
            allowCreate={canCreate}
            createOptionPrefix="+ Create"
            expandUp={position.bottom !== undefined}
            ref={inputRef}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Upward-opening field picker. OLAutocomplete owns filtering, keyboard navigation,
 * highlighted-item state and create-item behavior; this wrapper owns the trigger,
 * fixed viewport positioning and which fields are offered for the current entry.
 */
export function BibAddFieldCombobox({
  placeholder,
  offered,
  standardFields,
  existingFields,
  onSelect,
}: {
  placeholder: string
  offered: string[]
  standardFields: string[]
  existingFields: string[]
  onSelect: (field: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{
    left: number
    bottom: number
  } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const byField = new Set(offered)
    return OPTIONAL_FIELD_TAXONOMY.flatMap(group =>
      group.fields
        .filter(field => byField.has(field.field))
        .map(field => ({
          value: field.field,
          label: field.label,
          group: fieldGroupLabel(group.label, key => t(key)),
        }))
    )
  }, [offered, t])

  const standardFieldSet = useMemo(
    () => new Set(standardFields.map(field => field.toLowerCase())),
    [standardFields]
  )
  const existingFieldSet = useMemo(
    () => new Set(existingFields.map(field => field.toLowerCase())),
    [existingFields]
  )

  const canCreate = useCallback(
    (input: string) => {
      const name = input.trim()
      if (!BIBTEX_IDENTIFIER_REGEX.test(name)) return false
      const normalized = name.toLowerCase()
      return !standardFieldSet.has(normalized) && !existingFieldSet.has(normalized)
    },
    [existingFieldSet, standardFieldSet]
  )

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    setMenuPosition({
      left: rect.left,
      bottom: Math.max(8, window.innerHeight - rect.top + 4),
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setMenuPosition(null)
  }, [])

  const openMenu = useCallback(() => {
    updateMenuPosition()
    setOpen(true)
  }, [updateMenuPosition])

  useTrackMenuPosition(open, updateMenuPosition)

  const handleSelect = useCallback((field: string) => {
    if (!field) {
      filterInputRef.current?.focus()
      return
    }

    onSelect(field)
    close()
  }, [close, onSelect])

  return (
    <div
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          close()
        }
      }}
    >
      <OLButton
        ref={buttonRef}
        type="button"
        variant="secondary"
        size="sm"
        leadingIcon="add"
        className="bibtex-add-field-button"
        onClick={() => (open ? close() : openMenu())}
      >
        {t('add_field')}
      </OLButton>

      {open && menuPosition !== null && (
        <div
          className="button-autocomplete-container position-fixed rounded-1 shadow p-2 expand-up"
          style={{
            top: 'auto',
            bottom: menuPosition.bottom,
            left: menuPosition.left,
          }}
        >
          <OLAutocomplete
            key="optional-field-autocomplete"
            items={items}
            onChange={handleSelect}
            placeholder={placeholder}
            label={t('add_optional_field')}
            showLabel={false}
            allowCreate={canCreate}
            createOptionPrefix="+ Create"
            expandUp
            isOpen={open}
            ref={filterInputRef}
          />
        </div>
      )}
    </div>
  )
}

