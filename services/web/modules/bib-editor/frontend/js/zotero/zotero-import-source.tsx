import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { getJSON } from '@/infrastructure/fetch-json'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLButton from '@/shared/components/ol/ol-button'
import { OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import type { ZoteroGroup } from './use-zotero-libraries'

type ZoteroCollection = {
  key: string
  name: string
  parentCollection: string | null
}

function collectionOptions(collections: ZoteroCollection[]) {
  const byKey = new Map(collections.map(c => [c.key, c]))
  return collections.map(collection => {
    const path = [collection.name]
    const visited = new Set([collection.key])
    let parentKey = collection.parentCollection
    while (parentKey && !visited.has(parentKey)) {
      const parent = byKey.get(parentKey)
      if (!parent) break
      path.unshift(parent.name)
      visited.add(parentKey)
      parentKey = parent.parentCollection
    }
    return { key: collection.key, label: path.join(' / ') }
  }).sort((a, b) => a.label.localeCompare(b.label))
}

type Props = {
  groups: ZoteroGroup[]
  visible: boolean
  onCancel: () => void
  onPreview: (bibliography: string) => void
}

export default function ZoteroImportSource({ groups, visible, onCancel, onPreview }: Props) {
  const { t } = useTranslation()
  const [groupId, setGroupId] = useState('')
  const [collectionKey, setCollectionKey] = useState('')
  const [format, setFormat] = useState('bibtex')
  const {
    data: collections, runAsync: loadCollections, reset,
    isLoading: collectionsLoading, isError: collectionsError, isSuccess,
  } = useAsync<ZoteroCollection[] | null>({ status: 'pending' })
  const { runAsync: loadExport, isLoading: loading, isError: failed } =
    useAsync<{ bibliography: string }>()
  const collectionsFailed = collectionsError || (isSuccess && collections === null)
  const request = useRef<AbortController | null>(null)
  const options = useMemo(() => collectionOptions(collections ?? []), [collections])

  useEffect(() => {
    const controller = new AbortController()
    const query = groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''
    reset()
    loadCollections(getJSON<ZoteroCollection[] | null>(`/user/zotero/collections${query}`, {
      signal: controller.signal,
    })).catch(() => {}) // useAsync exposes the error to the form.
    return () => controller.abort()
  }, [groupId, loadCollections, reset])

  useEffect(() => () => request.current?.abort(), [])

  async function preview() {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    const query = new URLSearchParams({ format })
    if (groupId) query.set('group_id', groupId)
    if (collectionKey) query.set('collection_key', collectionKey)
    try {
      const { bibliography } = await loadExport(getJSON<{ bibliography: string }>(
        `/user/zotero/export?${query}`, { signal: controller.signal }
      ))
      if (!controller.signal.aborted) onPreview(bibliography)
    } catch {
      // useAsync exposes the error to the form.
    } finally {
      request.current = null
    }
  }

  if (!visible) return null

  return (
    <>
      <OLModalBody>
        <OLFormGroup controlId="bib-zotero-library">
          <OLFormLabel>{t('library')}</OLFormLabel>
          <OLFormSelect value={groupId} disabled={loading} onChange={event => {
            setGroupId(event.target.value)
            setCollectionKey('')
          }}>
            <option value="">{t('my_library')}</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </OLFormSelect>
        </OLFormGroup>
        <OLFormGroup controlId="bib-zotero-collection">
          <OLFormLabel>{t('collection')}</OLFormLabel>
          <OLFormSelect value={collectionKey} disabled={loading || collectionsLoading}
            onChange={event => setCollectionKey(event.target.value)}>
            <option value="">{t('all_collections')}</option>
            {!groupId && <option value="publications">{t('my_publications')}</option>}
            {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </OLFormSelect>
        </OLFormGroup>
        {collectionsFailed && <Notification type="error" content={t('zotero_could_not_load_collections')} />}
        <OLFormGroup controlId="bib-zotero-format">
          <OLFormLabel>{t('format')}</OLFormLabel>
          <OLFormSelect value={format} disabled={loading} onChange={event => setFormat(event.target.value)}>
            <option value="bibtex">BibTeX</option>
            <option value="biblatex">BibLaTeX</option>
          </OLFormSelect>
        </OLFormGroup>
        {failed && <Notification type="error" content={t('could_not_import_this_reference')} />}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onCancel}>{t('cancel')}</OLButton>
        <OLButton variant="primary" disabled={loading || collectionsLoading} onClick={() => void preview()}>
          {loading ? t('loading') : t('preview')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}
