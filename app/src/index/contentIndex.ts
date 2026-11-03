// Content index: derived, rebuildable full-text index over ContentUnits.
// It never becomes the authoritative copy of a page, message or note, and it
// keeps a per-resource status so an unfinished index is not reported as
// "no results".

import type {
  ContentSelector,
  ContentUnit,
  IndexRecord,
  ResourceKind,
  SearchQuery,
  SearchResult
} from '../shared/contracts/content'
import { normalize, normalizeText, originalSpan, snippetAround, type NormalizedText } from './text.ts'
import { blockIdOfUnit, messageIdOfUnit, pageOfUnit } from './units.ts'

export type IndexStatus = 'pending' | 'ready' | 'failed'

export interface ResourceIndexEntry {
  resourceId: string
  kind: ResourceKind
  title: string
  revision: string
  status: IndexStatus
  unitCount: number
  indexedAt: number
  error?: string
}

export interface SearchDetail {
  results: SearchResult[]
  /** Pending or failed resources: absence of hits is not proof of absence. */
  incompleteResourceIds: string[]
  failedResourceIds: string[]
}

export interface ContentIndex {
  begin(resourceId: string, revision: string, kind: ResourceKind, title: string): void
  replaceUnits(
    resourceId: string,
    revision: string,
    meta: { kind: ResourceKind; title: string },
    units: ContentUnit[]
  ): void
  fail(resourceId: string, revision: string, error: string): void
  drop(resourceId: string): void
  hasFreshIndex(resourceId: string, revision: string): boolean
  units(resourceId: string): ContentUnit[]
  unit(unitId: string): ContentUnit | undefined
  record(unitId: string): IndexRecord | undefined
  entries(): ResourceIndexEntry[]
  status(resourceId: string): ResourceIndexEntry | undefined
  search(query: SearchQuery): SearchResult[]
  searchDetailed(query: SearchQuery): SearchDetail
  readonly size: number
}

export interface ContentIndexOptions {
  now?: () => number
  defaultLimit?: number
}

interface NormalCache {
  normalized: NormalizedText
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

function locatorOf(unit: ContentUnit, exact: string): ContentSelector {
  if (unit.kind === 'page') {
    return {
      type: 'document-text',
      page: pageOfUnit(unit.id) ?? unit.order + 1,
      quote: { exact }
    }
  }
  if (unit.kind === 'message') {
    const messageId = messageIdOfUnit(unit.id) ?? ''
    return { type: 'message', messageId, quote: { exact } }
  }
  const blockId = blockIdOfUnit(unit.id) ?? ''
  return { type: 'note-block', blockId, quote: { exact } }
}

export function createContentIndex(options: ContentIndexOptions = {}): ContentIndex {
  const now = options.now ?? (() => Date.now())
  const defaultLimit = options.defaultLimit ?? 40

  const entriesById = new Map<string, ResourceIndexEntry>()
  const unitsByResource = new Map<string, ContentUnit[]>()
  const records = new Map<string, IndexRecord>()
  const normalCache = new Map<string, NormalCache>()

  const clearResource = (resourceId: string): void => {
    for (const unit of unitsByResource.get(resourceId) ?? []) {
      records.delete(unit.id)
      normalCache.delete(unit.id)
    }
    unitsByResource.delete(resourceId)
  }

  const normalizedOf = (unit: ContentUnit): NormalizedText => {
    const cached = normalCache.get(unit.id)
    if (cached) return cached.normalized
    const normalized = normalizeText(unit.text)
    normalCache.set(unit.id, { normalized })
    return normalized
  }

  const index: ContentIndex = {
    begin(resourceId, revision, kind, title) {
      const previous = entriesById.get(resourceId)
      entriesById.set(resourceId, {
        resourceId,
        kind,
        title,
        revision,
        status: 'pending',
        unitCount: 0,
        indexedAt: previous?.revision === revision ? previous.indexedAt : 0
      })
    },

    replaceUnits(resourceId, revision, meta, units) {
      clearResource(resourceId)
      unitsByResource.set(resourceId, units)
      const indexedAt = now()
      for (const unit of units) {
        records.set(unit.id, {
          unitId: unit.id,
          resourceId,
          resourceKind: meta.kind,
          title: meta.title,
          text: unit.text,
          revision,
          indexedAt
        })
      }
      entriesById.set(resourceId, {
        resourceId,
        kind: meta.kind,
        title: meta.title,
        revision,
        status: 'ready',
        unitCount: units.length,
        indexedAt
      })
    },

    fail(resourceId, revision, error) {
      const previous = entriesById.get(resourceId)
      entriesById.set(resourceId, {
        resourceId,
        kind: previous?.kind ?? 'document',
        title: previous?.title ?? '',
        revision,
        status: 'failed',
        unitCount: previous?.revision === revision ? previous.unitCount : 0,
        indexedAt: previous?.revision === revision ? previous.indexedAt : 0,
        error
      })
    },

    drop(resourceId) {
      clearResource(resourceId)
      entriesById.delete(resourceId)
    },

    hasFreshIndex(resourceId, revision) {
      const entry = entriesById.get(resourceId)
      return entry?.status === 'ready' && entry.revision === revision
    },

    units(resourceId) {
      return unitsByResource.get(resourceId) ?? []
    },

    unit(unitId) {
      for (const units of unitsByResource.values()) {
        const found = units.find((item) => item.id === unitId)
        if (found) return found
      }
      return undefined
    },

    record(unitId) {
      return records.get(unitId)
    },

    entries() {
      return [...entriesById.values()]
    },

    status(resourceId) {
      return entriesById.get(resourceId)
    },

    search(query) {
      return index.searchDetailed(query).results
    },

    searchDetailed(query) {
      const raw = query.text.trim()
      const empty: SearchDetail = { results: [], incompleteResourceIds: [], failedResourceIds: [] }
      if (!raw) return empty

      const terms = raw
        .split(/\s+/)
        .map((term) => normalize(term))
        .filter(Boolean)
      if (!terms.length) return empty

      const limit = clamp(query.limit ?? defaultLimit, 1, 200)
      const kinds = query.resourceKinds?.length ? new Set(query.resourceKinds) : null
      const resourceIds = query.resourceIds?.length ? new Set(query.resourceIds) : null
      const incompleteResourceIds: string[] = []
      const failedResourceIds: string[] = []
      const results: SearchResult[] = []

      for (const entry of entriesById.values()) {
        if (kinds && !kinds.has(entry.kind)) continue
        if (resourceIds && !resourceIds.has(entry.resourceId)) continue
        if (entry.status !== 'ready') {
          incompleteResourceIds.push(entry.resourceId)
          if (entry.status === 'failed') failedResourceIds.push(entry.resourceId)
          continue
        }
        for (const unit of unitsByResource.get(entry.resourceId) ?? []) {
          if (!unit.text) continue
          const normalized = normalizedOf(unit)
          let score = 0
          let firstAt = -1
          let firstLength = 0
          let matched = true
          for (const term of terms) {
            const at = normalized.text.indexOf(term)
            if (at < 0) {
              matched = false
              break
            }
            let occurrences = 0
            let from = 0
            for (;;) {
              const hit = normalized.text.indexOf(term, from)
              if (hit < 0) break
              occurrences += 1
              from = hit + 1
            }
            score += occurrences
            if (firstAt < 0 || at < firstAt) {
              firstAt = at
              firstLength = term.length
            }
          }
          if (!matched) continue

          const titleNorm = normalize(entry.title)
          if (terms.every((term) => titleNorm.includes(term))) score += 4
          if (normalized.text.includes(terms.join(''))) score += 2

          const span = originalSpan(unit.text, normalized, firstAt, firstLength)
          const exact = unit.text.slice(span.start, span.end).trim() || unit.text.slice(0, 120)
          results.push({
            unitId: unit.id,
            resourceId: entry.resourceId,
            score,
            snippet: snippetAround(unit.text, normalized, firstAt, firstLength),
            locator: locatorOf(unit, exact)
          })
        }
      }

      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const titleA = records.get(a.unitId)?.title ?? ''
        const titleB = records.get(b.unitId)?.title ?? ''
        if (titleA !== titleB) return titleA.localeCompare(titleB)
        return a.unitId.localeCompare(b.unitId)
      })

      return {
        results: results.slice(0, limit),
        incompleteResourceIds,
        failedResourceIds
      }
    },

    get size() {
      return records.size
    }
  }

  return index
}
