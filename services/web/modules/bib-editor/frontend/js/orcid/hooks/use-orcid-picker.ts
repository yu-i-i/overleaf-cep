/** ORCID search, selection and enrichment state for the BibTeX import modal. */
import { useState, useCallback, useEffect, useRef } from 'react'
import { withWorkSummary, workMetadataScore, hasMissingWorkFields } from '../work-metadata'
import { searchOrcidAuthors, fetchOrcidWorks, fetchOrcidWorkDetails, fetchDoiMetadataBatch, isValidOrcid, parseImportItem, workDoi, normalizedDoi, isRateLimit, errorMessage } from '../orcid-api'
import type { AuthorResult, Work, WorkVariant, OrcidImportItem, ImportResult } from '../orcid-api'

type OrcidInspection = { needsMetadata: boolean }
type OrcidPickerOptions = {
  show: boolean
  onHide: () => void
  onInspect: (item: OrcidImportItem) => OrcidInspection | null
  onInsert: (items: OrcidImportItem[]) => ImportResult | false | Promise<ImportResult | false>
  t: (key: string, options?: Record<string, unknown>) => string
}

type Step = 'search' | 'works'
const ORCID_BATCH_SIZE = 100
type CrossrefFailure = 'rate-limit' | 'unavailable'
type FailedEnrichment = { title: string; reason: CrossrefFailure }
type ImportSummary = { imported: number; enriched: number }

export function useOrcidPicker({ show, onHide, onInsert, onInspect, t }: OrcidPickerOptions) {
  // -- step state --
  const [step, setStep] = useState<Step>('search')

  // -- search step --
  const [searchMode, setSearchMode] = useState<'name' | 'orcid'>('name')
  const [nameQuery, setNameQuery] = useState('')
  const [orcidInput, setOrcidInput] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [authors, setAuthors] = useState<AuthorResult[]>([])

  // -- works step --
  const [selectedOrcid, setSelectedOrcid] = useState<string | null>(null)
  const [selectedAuthorName, setSelectedAuthorName] = useState('')
  const [works, setWorks] = useState<Work[]>([])
  const [worksLoading, setWorksLoading] = useState(false)
  const [worksError, setWorksError] = useState<string | null>(null)
  // Keep successful details across failed imports, avoiding repeat ORCID calls.
  const workDetails = useRef(new Map<number, OrcidImportItem>())
  // Retry large failed ORCID batches in smaller groups on the next user click.
  // No automatic retry (especially after HTTP 429).
  const retryBatchSizes = useRef(new Map<number, number>())
  const [selectedPutCodes, setSelectedPutCodes] = useState<Set<number>>(
    new Set()
  )

  // -- import state --
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [crossrefFailures, setCrossrefFailures] = useState<FailedEnrichment[]>([])
  const [unimportedTitles, setUnimportedTitles] = useState<string[]>([])
  const requests = useRef<Partial<Record<'search' | 'works' | 'import', AbortController>>>({})

  const cancelRequest = (kind: 'search' | 'works' | 'import') => {
    requests.current[kind]?.abort()
    delete requests.current[kind]
  }

  const cancelAll = useCallback(() => {
    for (const controller of Object.values(requests.current)) controller?.abort()
    requests.current = {}
  }, [])

  const resetPicker = useCallback(() => {
    cancelAll()
    setStep('search')
    setSearchMode('name')
    setNameQuery('')
    setOrcidInput('')
    setSearchLoading(false)
    setSearchError(null)
    setAuthors([])
    setSelectedOrcid(null)
    setSelectedAuthorName('')
    setWorks([])
    setWorksLoading(false)
    setWorksError(null)
    workDetails.current.clear()
    retryBatchSizes.current.clear()
    setSelectedPutCodes(new Set())
    setImporting(false)
    setImportError(null)
    setImportSummary(null)
    setCrossrefFailures([])
    setUnimportedTitles([])
  }, [cancelAll])

  useEffect(() => {
    if (!show) resetPicker()
    return cancelAll
  }, [show, resetPicker, cancelAll])

  const handleClose = () => {
    resetPicker()
    onHide()
  }

  const handleSearchModeChange = (mode: 'name' | 'orcid') => {
    cancelRequest('search')
    setSearchLoading(false)
    setSearchMode(mode)
    setSearchError(null)
    setAuthors([])
  }

  // Search by name
  const handleSearchByName = async () => {
    if (!nameQuery.trim() || searchLoading) return
    cancelRequest('search')
    const controller = new AbortController()
    requests.current.search = controller
    setSearchError(null)
    setAuthors([])
    setSearchLoading(true)
    try {
      const data = await searchOrcidAuthors(nameQuery.trim(), controller.signal)
      if (requests.current.search !== controller) return
      setAuthors(data.results)
      if (data.results.length === 0) {
        setSearchError(t('no_authors_found'))
      }
    } catch (err) {
      if (requests.current.search === controller) {
        setSearchError(errorMessage(err, t('search_failed'), t('invalid_response_from_server'), t('provider_rate_limited')))
      }
    } finally {
      if (requests.current.search === controller) {
        delete requests.current.search
        setSearchLoading(false)
      }
    }
  }

  // Only the one ORCID works-summary request runs when opening the list.
  // Full details and DOI resolution are deferred to Import.
  const handlePickAuthor = async (orcid: string, displayName: string) => {
    cancelRequest('works')
    const controller = new AbortController()
    requests.current.works = controller
    setSelectedOrcid(orcid)
    setSelectedAuthorName(displayName)
    setStep('works')
    setWorksError(null)
    setImportError(null)
    setImportSummary(null)
    setCrossrefFailures([])
    setUnimportedTitles([])
    setWorks([])
    setSelectedPutCodes(new Set())
    workDetails.current.clear()
    retryBatchSizes.current.clear()
    setWorksLoading(true)
    try {
      const data = await fetchOrcidWorks(orcid, controller.signal)
      if (requests.current.works !== controller) return
      const returnedWorks = data.works
      setWorks(returnedWorks)
      if (!returnedWorks.length) setWorksError(t('no_works_found_for_this_author'))
    } catch (err) {
      if (requests.current.works === controller) {
        setWorksError(errorMessage(err, t('failed_to_load_works'), t('invalid_response_from_server'), t('provider_rate_limited')))
      }
    } finally {
      if (requests.current.works === controller) {
        delete requests.current.works
        setWorksLoading(false)
      }
    }
  }
  // Direct ORCID input
  const handleGoToWorksByOrcid = async () => {
    const orcid = orcidInput.trim()
    if (!isValidOrcid(orcid)) return
    setSearchError(null)
    await handlePickAuthor(orcid, orcid)
  }

  // Toggle a work selection (by put-code)
  const toggleWork = (putCode: number) => {
    if (importing) return
    setSelectedPutCodes(prev => {
      const next = new Set(prev)
      if (next.has(putCode)) {
        next.delete(putCode)
      } else {
        next.add(putCode)
      }
      return next
    })
  }

  // Select / deselect all works; summaries need no detailed metadata.
  const allSelected = works.length > 0 && selectedPutCodes.size === works.length

  const toggleAll = () => {
    if (worksLoading || importing) return
    setSelectedPutCodes(allSelected ? new Set() : new Set(works.map(work => work.putCode)))
  }

  // Import one selection; a successful write displays a final report.
  const handleImport = async () => {
    if (importSummary || !selectedOrcid || selectedPutCodes.size === 0 || requests.current.import) return
    const controller = new AbortController()
    requests.current.import = controller
    const active = () => requests.current.import === controller && !controller.signal.aborted
    const selected = works.filter(work => selectedPutCodes.has(work.putCode))
    setImporting(true)
    setImportError(null)

    // The host decides whether the item is usable or needs more metadata.
    // Cache that decision until the item changes through enrichment.
    const inspected = new WeakMap<OrcidImportItem, OrcidInspection | null>()
    const inspect = (item: OrcidImportItem): OrcidInspection | null => {
      if (inspected.has(item)) return inspected.get(item) ?? null
      let result: OrcidInspection | null = null
      try {
        result = onInspect(item)
      } catch {
        // Invalid optional source; the host may accept an alternate source.
      }
      inspected.set(item, result)
      return result
    }
    // Parsing and validation are owned by the BibTeX editor, never the server.
    const validCandidate = (item: OrcidImportItem): OrcidImportItem => {
      if (!('bibtex' in item) || inspect(item)) return item
      return item.work ? { work: item.work } : item
    }
    const needsMetadata = (item: OrcidImportItem) => {
      const result = inspect(item)
      return !result || result.needsMetadata
    }

    let rateLimited = false
    const failedEnrichment = new Map<number, CrossrefFailure>()
    try {
      // Bulk ORCID detail retrieval is sequential, and limited to selection.
      // No requests at all for already cached details.
      const missing = selected.filter(work => !workDetails.current.has(work.putCode))
      for (let start = 0; start < missing.length;) {
        const size = retryBatchSizes.current.get(missing[start].putCode) ?? ORCID_BATCH_SIZE
        const batch: Work[] = []
        while (start < missing.length && batch.length < size &&
            (retryBatchSizes.current.get(missing[start].putCode) ?? ORCID_BATCH_SIZE) === size) {
          batch.push(missing[start++])
        }
        const smallerOnRetry = () => {
          const nextSize = Math.max(1, Math.ceil(batch.length / 4))
          for (const work of batch) retryBatchSizes.current.set(work.putCode, nextSize)
        }
        let result: unknown
        try {
          result = await fetchOrcidWorkDetails(selectedOrcid, batch.map(work => work.putCode), controller.signal)
        } catch (err) {
          if (!active()) return
          if (isRateLimit(err)) {
            rateLimited = true
            break // No further provider requests after a 429.
          }
          smallerOnRetry()
          continue
        }
        if (!active()) return
        if (!result || typeof result !== 'object' || !Array.isArray((result as { results?: unknown }).results)) {
          smallerOnRetry()
          continue
        }
        const returned = new Map<number, OrcidImportItem>()
        const allowed = new Set(batch.map(work => work.putCode))
        for (const row of (result as { results: unknown[] }).results) {
          if (!row || typeof row !== 'object') continue
          const { putCode, item, failure } = row as { putCode?: number; item?: unknown; failure?: string }
          if (typeof putCode !== 'number' || !allowed.has(putCode)) continue
          const parsed = parseImportItem(item)
          if (parsed) returned.set(putCode, parsed)
          if (failure === 'rate-limit') rateLimited = true
        }
        for (const work of batch) {
          const item = returned.get(work.putCode)
          if (item) {
            workDetails.current.set(work.putCode, withWorkSummary(item, work))
            retryBatchSizes.current.delete(work.putCode)
          } else {
            // A missing work is retried independently, not with an entire
            // previously successful batch.
            retryBatchSizes.current.set(work.putCode, 1)
          }
        }
        if (rateLimited) break
      }

      const prepared = new Map<number, OrcidImportItem>()
      for (const work of selected) {
        const detail = workDetails.current.get(work.putCode)
        if (!detail) continue
        const item = validCandidate(withWorkSummary(detail, work))
        prepared.set(work.putCode, item)
        workDetails.current.set(work.putCode, item)
      }

      // Inspect grouped alternatives only when a selected source lacks authors,
      // title or year. Preserve the original source when it is equally complete.
      const selectedByCode = new Map<number, WorkVariant>(selected.map(work => [work.putCode, work]))
      const needsAlternate = (work: Work) => {
        const item = prepared.get(work.putCode)
        const summary = selectedByCode.get(work.putCode)!
        return !!item && (needsMetadata(item) || hasMissingWorkFields(summary, item))
      }
      const alternatives = selected.filter(work => work.variants?.length && needsAlternate(work))
      const maxAlternatives = Math.max(0, ...alternatives.map(work => work.variants!.length))
      for (let index = 0; index < maxAlternatives && !rateLimited; index++) {
        const candidates = alternatives.filter(work => work.variants![index] && needsAlternate(work))
        const variants = new Map(candidates.map(work => [work.variants![index].putCode, work.variants![index]]))
        const codes = [...variants.keys()]
        for (let start = 0; start < codes.length && !rateLimited; start += ORCID_BATCH_SIZE) {
          let result: Awaited<ReturnType<typeof fetchOrcidWorkDetails>>
          try {
            result = await fetchOrcidWorkDetails(selectedOrcid, codes.slice(start, start + ORCID_BATCH_SIZE), controller.signal)
          } catch (err) {
            if (!active()) return
            if (isRateLimit(err)) rateLimited = true
            continue
          }
          if (!active()) return
          const found = new Map(result.results.flatMap(row => {
            const item = parseImportItem(row.item)
            return item ? [[row.putCode, item] as const] : []
          }))
          for (const work of candidates) {
            const variant = work.variants![index]
            if (!found.has(variant.putCode)) continue
            const current = prepared.get(work.putCode)!
            const source = selectedByCode.get(work.putCode)!
            let alternate = validCandidate(withWorkSummary(found.get(variant.putCode)!, variant))
            // Keep the original valid citation (and its supplied key), while
            // adding structured fields from a better alternate ORCID source.
            if ('bibtex' in current && inspect(current)) {
              alternate = { ...alternate, bibtex: current.bibtex }
            }
            alternate = withWorkSummary(alternate, source)
            const prior = inspect(current)
            const next = inspect(alternate)
            if (!next) continue
            const priorScore = workMetadataScore(source, current) + Number(!!prior && !prior.needsMetadata) * 16
            const nextScore = workMetadataScore(variant, alternate) + Number(!next.needsMetadata) * 16
            if (nextScore <= priorScore) continue
            prepared.set(work.putCode, alternate)
            workDetails.current.set(work.putCode, alternate)
            selectedByCode.set(work.putCode, variant)
          }
        }
      }
      if (!active()) return

      // Only incomplete references are sent to Crossref. Failures use ORCID data.
      // Only exact DOI lookup through Crossref remains. Missing metadata is
      // imported from ORCID as-is; no DataCite or arXiv requests are made.
      const doiByCode = new Map<number, string>()
      for (const work of rateLimited ? [] : selected.filter(work =>
        prepared.has(work.putCode) && needsMetadata(prepared.get(work.putCode)!)
      )) {
        const item = prepared.get(work.putCode)!
        const doi = workDoi(item, selectedByCode.get(work.putCode)!)
        if (!doi) continue
        const key = normalizedDoi(doi)
        if (!key) continue
        // Keep an unambiguous grouped DOI in the structured work for import.
        if (item.work && !item.work['external-ids']?.['external-id']?.some(
          id => id['external-id-type']?.toLowerCase() === 'doi'
        )) {
          const supplemented = { ...item, work: { ...item.work, 'external-ids': { 'external-id': [
            ...(item.work['external-ids']?.['external-id'] ?? []),
            { 'external-id-type': 'doi', 'external-id-value': doi },
          ] } } }
          prepared.set(work.putCode, supplemented)
          workDetails.current.set(work.putCode, supplemented)
        }
        // Known arXiv DataCite DOIs are not registered at Crossref.
        if (!item.doi && !key.startsWith('10.48550/arxiv.')) doiByCode.set(work.putCode, key)
      }
      const lookupDois = [...new Set(doiByCode.values())]
      for (let start = 0; start < lookupDois.length && !rateLimited; start += 150) {
        const batch = lookupDois.slice(start, start + 150)
        let result: Awaited<ReturnType<typeof fetchDoiMetadataBatch>>
        try {
          result = await fetchDoiMetadataBatch(batch, controller.signal)
        } catch (error) {
          if (!active()) return
          // Even an immediately rejected request was attempted. Do not mark
          // later, untouched batches as Crossref failures.
          result = { entries: new Map(), attempted: new Set(batch),
            rateLimited: new Set(isRateLimit(error) ? batch : []), error }
        }
        if (!active()) return
        for (const [code, doi] of doiByCode) {
          if (!batch.includes(doi)) continue
          const metadata = result.entries.get(doi)
          if (metadata && needsMetadata(prepared.get(code)!)) {
            const enriched = { ...prepared.get(code)!, doi: metadata }
            prepared.set(code, enriched)
            workDetails.current.set(code, enriched)
            failedEnrichment.delete(code)
          } else if (result.attempted.has(doi)) {
            failedEnrichment.set(code, result.rateLimited.has(doi) ? 'rate-limit' : 'unavailable')
          }
        }
        if (result.error && (isRateLimit(result.error) ||
            (result.error instanceof Error && result.error.name === 'AbortError'))) {
          rateLimited = isRateLimit(result.error)
          break
        }
      }
      if (!active()) return
      // No DOI or no Crossref attempt is not a failure. Import ORCID-only
      // entries for failed Crossref lookups in the same guarded transaction.
      const ready = selected.filter(work => {
        const item = prepared.get(work.putCode)
        return item && inspect(item)
      })
      let skippedCodes = new Set<number>()
      if (ready.length) {
        const committed = await onInsert(ready.map(work => prepared.get(work.putCode)!))
        if (!committed) {
          if (active()) setImportError(t('import_failed'))
          return // Do not report an import that was rejected by the editor.
        }
        if (!active()) return
        setImportSummary({ imported: committed.imported, enriched: committed.enriched })
        skippedCodes = new Set(committed.skippedIndices.flatMap(index =>
          ready[index] ? [ready[index].putCode] : []))
        const unusable = new Set(committed.unusableIndices)
        setCrossrefFailures(ready.flatMap((work, index) => {
          if (skippedCodes.has(work.putCode)) return []
          const reason = failedEnrichment.get(work.putCode) ||
            (unusable.has(index) ? 'unavailable' : null)
          return reason ? [{ title: work.title || t('untitled'), reason }] : []
        }))
      }
      const unimported = selected.filter(work => !ready.includes(work) || skippedCodes.has(work.putCode))
      if (unimported.length) {
        setUnimportedTitles(unimported.map(work => work.title || t('untitled')))
        const message = t(skippedCodes.size
          ? 'some_works_could_not_be_imported' : 'some_works_could_not_be_fetched')
        setImportError(rateLimited
          ? `${message}. ${t('provider_rate_limited')}` : message)
      }
      // The report replaces the works list after any successful import.
    } catch (err) {
      if (active()) {
        setImportError(errorMessage(err, t('import_failed'), t('invalid_response_from_server'), t('provider_rate_limited')))
      }
    } finally {
      if (active()) {
        delete requests.current.import
        setImporting(false)
      }
    }
  }

  const goBack = () => {
    cancelRequest('works')
    setWorksLoading(false)
    setStep('search')
    setWorksError(null)
    setImportError(null)
  }

  const changeNameQuery = (value: string) => {
    cancelRequest('search')
    setAuthors([])
    setSearchError(null)
    setSearchLoading(false)
    setNameQuery(value)
  }

  return {
    step, searchMode, nameQuery, orcidInput, searchLoading, searchError, authors,
    selectedAuthorName, works, worksLoading, worksError, selectedPutCodes,
    importing, importError, importSummary, crossrefFailures, unimportedTitles, allSelected,
    setOrcidInput, setSearchError, setWorksError, setImportError,
    handleClose, goBack, handleSearchModeChange, changeNameQuery,
    handleSearchByName, handleGoToWorksByOrcid, handlePickAuthor,
    toggleWork, toggleAll, handleImport,
  }
}
