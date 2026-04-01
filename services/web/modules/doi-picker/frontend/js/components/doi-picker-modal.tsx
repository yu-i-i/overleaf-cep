import { useState, useCallback } from 'react'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLNotification from '@/shared/components/notification'
import { getJSON } from '@/infrastructure/fetch-json'

type DoiPickerModalProps = {
  show: boolean
  handleHide: () => void
  onInsert: (bibtex: string) => void
}

export default function DoiPickerModal({
  show,
  handleHide,
  onInsert,
}: DoiPickerModalProps) {
  const [doi, setDoi] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bibtex, setBibtex] = useState<string | null>(null)

  const handleFetch = useCallback(async () => {
    if (!doi.trim()) return
    setError(null)
    setBibtex(null)
    setLoading(true)
    try {
      const data = await getJSON<{ bibtex: string }>(
        `/doi-picker/fetch?doi=${encodeURIComponent(doi.trim())}`
      )
      setBibtex(data.bibtex)
    } catch (err: any) {
      setError(err?.data?.error || err?.message || 'Failed to fetch DOI')
    } finally {
      setLoading(false)
    }
  }, [doi])

  const handleInsert = useCallback(() => {
    if (bibtex) {
      onInsert(bibtex)
      setDoi('')
      setBibtex(null)
      setError(null)
      handleHide()
    }
  }, [bibtex, onInsert, handleHide])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleFetch()
      }
    },
    [handleFetch]
  )

  return (
    <OLModal show={show} onHide={handleHide}>
      <OLModalHeader closeButton>
        <OLModalTitle>Import from DOI</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <OLFormGroup>
          <OLFormLabel htmlFor="doi-picker-input">DOI</OLFormLabel>
          <div style={{ display: 'flex', gap: '8px' }}>
            <OLFormControl
              id="doi-picker-input"
              type="text"
              placeholder="e.g. 10.1000/xyz123"
              value={doi}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDoi(e.target.value)
              }
              onKeyDown={handleKeyDown}
              disabled={loading}
              autoFocus
            />
            <OLButton
              variant="primary"
              onClick={handleFetch}
              disabled={loading || !doi.trim()}
              isLoading={loading}
            >
              Fetch
            </OLButton>
          </div>
        </OLFormGroup>
        {error && (
          <OLNotification type="error" content={error} isDismissible />
        )}
        {bibtex && (
          <OLFormGroup>
            <OLFormLabel>BibTeX result</OLFormLabel>
            <pre
              style={{
                maxHeight: '200px',
                overflow: 'auto',
                padding: '8px',
                backgroundColor: 'var(--bg-light-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '12px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {bibtex}
            </pre>
          </OLFormGroup>
        )}
      </OLModalBody>
      {bibtex && (
        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleHide}>
            Cancel
          </OLButton>
          <OLButton variant="primary" onClick={handleInsert}>
            Insert into file
          </OLButton>
        </OLModalFooter>
      )}
    </OLModal>
  )
}
