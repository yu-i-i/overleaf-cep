import { ReferenceIndex } from '@/features/ide-react/references/reference-index'
import type {
  Changes,
  Bib2JsonEntry,
  AdvancedReferenceSearchResult,
} from '@/features/ide-react/references/types'
import Fuse, { IFuseOptions, FuseResult } from 'fuse.js'

const MAX_RESULTS = 50

export default class EnhancedReferenceIndex extends ReferenceIndex {
  fileIndex: Map<string, Set<string>> = new Map()
  entryIndex: Map<string, Bib2JsonEntry> = new Map()
  fuse: Fuse<Bib2JsonEntry> | null = null

  updateIndex({ updates, deletes }: Changes): Set<string> {
    for (const path of deletes) {
      const keys = this.fileIndex.get(path)
      if (keys) {
        for (const k of keys) {
          this.entryIndex.delete(k)
        }
      }
      this.fileIndex.delete(path)
    }

    for (const { path, content } of updates) {
      const previous = this.fileIndex.get(path)
      if (previous) {
        for (const k of previous) {
          this.entryIndex.delete(k)
        }
      }
      const fileReferences = new Set<string>()
      const entries = this.parseEntries(content)
      for (const entry of entries) {
        fileReferences.add(entry.EntryKey)
        this.entryIndex.set(entry.EntryKey, entry)
      }
      this.fileIndex.set(path, fileReferences)
    }

    this.keys = new Set(
      this.fileIndex.values().flatMap(entry => Array.from(entry))
    )
    this.rebuildFuseIndex()
    return this.keys
  }

  private rebuildFuseIndex() {
    const data = Array.from(this.entryIndex.values())
    try {
      const options: IFuseOptions<Bib2JsonEntry> = {
        includeScore: true,
        includeMatches: true,
        threshold: 0.35,
        ignoreLocation: true,
        keys: [
          { name: 'EntryKey', weight: 0.8 },
          { name: 'Fields.title', weight: 0.6 },
          { name: 'Fields.author', weight: 0.5 },
          { name: 'Fields.journal', weight: 0.3 },
          { name: 'Fields.year', weight: 0.2 },
        ],
      }
      this.fuse = new Fuse(data, options)
    } catch {
      this.fuse = null
    }
  }

  async search(query: string): Promise<AdvancedReferenceSearchResult> {
    const q = (query || '').toLowerCase().trim()

    // Empty query: return all entries (used by the picker to list references)
    if (!q) {
      return this.list(MAX_RESULTS)
    }

    const tokens = q.split(/\s+/).filter(Boolean)
    const isSingleYear = tokens.length === 1 && /^[0-9]{4}$/.test(tokens[0])

    // Exact year match shortcut
    if (isSingleYear) {
      const yearHits = this.substringScan(q, entry =>
        (entry.Fields.year || '').trim() === tokens[0]
      )
      if (yearHits.length > 0) return { hits: yearHits }
    }

    // Short queries or no Fuse index: substring scan
    if (q.length <= 2 || !this.fuse) {
      return { hits: this.substringScan(q) }
    }

    // Fuse-based fuzzy search
    try {
      return { hits: this.fuseSearch(q, tokens) }
    } catch {
      return { hits: this.substringScan(q) }
    }
  }

  private list(limit: number): AdvancedReferenceSearchResult {
    const results: { _source: Bib2JsonEntry }[] = []
    for (const entry of this.entryIndex.values()) {
      if (results.length >= limit) break
      results.push({ _source: entry })
    }
    return { hits: results }
  }

  private matchesAnyField(entry: Bib2JsonEntry, q: string): boolean {
    if (entry.EntryKey.toLowerCase().includes(q)) return true
    const f = entry.Fields
    if (f.title?.toLowerCase().includes(q)) return true
    if (f.author?.toLowerCase().includes(q)) return true
    if (f.journal?.toLowerCase().includes(q)) return true
    if (f.year?.toLowerCase().includes(q)) return true
    return false
  }

  private substringScan(
    q: string,
    predicate?: (entry: Bib2JsonEntry) => boolean
  ): { _source: Bib2JsonEntry }[] {
    const results: { _source: Bib2JsonEntry }[] = []
    for (const entry of this.entryIndex.values()) {
      if (results.length >= MAX_RESULTS) break
      if (predicate ? predicate(entry) : this.matchesAnyField(entry, q)) {
        results.push({ _source: entry })
      }
    }
    return results
  }

  private tokenSubstringScan(
    tokens: string[]
  ): { _source: Bib2JsonEntry }[] {
    const results: { _source: Bib2JsonEntry }[] = []
    for (const entry of this.entryIndex.values()) {
      if (results.length >= MAX_RESULTS) break
      const match = tokens.every(t => this.matchesAnyField(entry, t))
      if (match) results.push({ _source: entry })
    }
    return results
  }

  private fuseSearch(
    q: string,
    tokens: string[]
  ): { _source: Bib2JsonEntry }[] {
    const fuseResults = this.fuse!.search(q, { limit: MAX_RESULTS }) as FuseResult<Bib2JsonEntry>[]

    let mapped = fuseResults.map(r => ({ _source: r.item }))

    // Supplement with substring matches to catch anything Fuse missed
    const seen = new Set(mapped.map(m => m._source.EntryKey))
    const extra = this.tokenSubstringScan(tokens)
      .filter(r => !seen.has(r._source.EntryKey))
    if (extra.length) {
      mapped = [...mapped, ...extra]
    }

    return mapped
  }
}
