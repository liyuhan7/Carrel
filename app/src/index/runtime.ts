// Store-backed runtime for the unified index: one content index, one relation
// index, one resolver and one search service per renderer process.
// `sync()` reconciles resources, migrates legacy NoteRefs and refreshes the
// derived index; it is idempotent and does no work when nothing changed.

import { useEffect } from 'react'
import type {
  AnchorResolver,
  ContentUnit,
  Resource,
  ResourceKind,
  SearchResult
} from '../shared/contracts/content'
import { textCache, useStore } from '../store'
import type { ChatMessage } from '../types'
import { createContentIndex, type ContentIndex } from './contentIndex.ts'
import { createAnchorResolver } from './resolver.ts'
import { createRelationIndex, type RelationIndex } from './relations.ts'
import { createSearchService, type IndexSearchService } from './search.ts'
import { syncResourceRegistry } from './resourceSync.ts'
import { migrateLegacyRefs } from './migrationRuntime.ts'
import { markdownBlocks, messageUnits, noteBlockUnits, pageUnits } from './units.ts'

export interface IndexRuntime {
  index: ContentIndex
  relations: RelationIndex
  resolver: AnchorResolver
  search: IndexSearchService
  /** Reconciles resources, runs migrations and refreshes the derived index. */
  sync(): Promise<void>
  /** Notifies after a sync changed the index; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Resolves page texts for a document source, caching what it loads. */
  pagesFor(sourceId: string): Promise<string[] | null>
  resourceFor(kind: ResourceKind, sourceId: string): Resource | undefined
  anchorUnits(resourceId: string): ContentUnit[]
}

let runtime: IndexRuntime | null = null

async function loadPages(sourceId: string): Promise<string[] | null> {
  const cached = textCache.get(sourceId)
  if (cached) return cached
  if (typeof window === 'undefined' || !window.cs) return null
  const pages = await window.cs.getText(sourceId)
  if (pages) textCache.set(sourceId, pages)
  return pages
}

function buildRuntime(): IndexRuntime {
  const index = createContentIndex()
  const relations = createRelationIndex(() => {
    const state = useStore.getState()
    return { resources: state.resources, anchors: state.anchors, links: state.links }
  })
  const resolver = createAnchorResolver({
    getResource: (resourceId) => useStore.getState().resources[resourceId],
    getPages: (sourceId) => textCache.get(sourceId) ?? null,
    getUnits: (resourceId) => index.units(resourceId)
  })
  const search = createSearchService(index)

  let running: Promise<void> | null = null
  let rerun = false
  const listeners = new Set<() => void>()

  const runSync = async (): Promise<void> => {
    const state = useStore.getState()
    if (!state.hydrated) return

    await syncResourceRegistry({
      transactions: state.transactions,
      resources: state.resources,
      files: state.files,
      notes: state.notes,
      messages: state.messages
    })

    const afterResources = useStore.getState()
    await migrateLegacyRefs({
      transactions: afterResources.transactions,
      anchorService: afterResources.anchorService,
      linkService: afterResources.linkService,
      resources: afterResources.resources,
      anchors: afterResources.anchors,
      links: afterResources.links,
      files: afterResources.files,
      notes: afterResources.notes
    })

    const current = useStore.getState()
    const resources = Object.values(current.resources)
    const alive = new Set(resources.map((resource) => resource.id))
    for (const entry of index.entries()) {
      if (!alive.has(entry.resourceId)) index.drop(entry.resourceId)
    }

    for (const resource of resources) {
      // Unavailable content must not stay reachable through the index cache.
      if (resource.availability !== 'available') {
        index.drop(resource.id)
        continue
      }
      if (index.hasFreshIndex(resource.id, resource.revision)) continue
      index.begin(resource.id, resource.revision, resource.kind, resource.title)
      try {
        const units = await extractUnits(resource, current.notes, current.messages)
        index.replaceUnits(
          resource.id,
          resource.revision,
          { kind: resource.kind, title: resource.title },
          units
        )
      } catch (error) {
        index.fail(resource.id, resource.revision, (error as Error).message)
      }
    }
  }

  const sync = (): Promise<void> => {
    if (running) {
      rerun = true
      return running
    }
    running = runSync().finally(() => {
      running = null
      for (const listener of listeners) listener()
      if (rerun) {
        rerun = false
        void sync()
      }
    })
    return running
  }

  return {
    index,
    relations,
    resolver,
    search,
    sync,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    pagesFor: loadPages,
    resourceFor(kind, sourceId) {
      return Object.values(useStore.getState().resources).find(
        (resource) => resource.kind === kind && resource.sourceId === sourceId
      )
    },
    anchorUnits(resourceId) {
      return index.units(resourceId)
    }
  }
}

async function extractUnits(
  resource: Resource,
  notes: { id: string; body: string }[],
  messages: ChatMessage[]
): Promise<ContentUnit[]> {
  if (resource.kind === 'document') {
    const pages = await loadPages(resource.sourceId)
    if (!pages) throw new Error('没有可用的页面文本，暂不索引')
    return pageUnits(resource.id, resource.revision, pages)
  }
  if (resource.kind === 'conversation') {
    return messageUnits(resource.id, resource.revision, messages)
  }
  const note = notes.find((item) => item.id === resource.sourceId)
  if (!note) throw new Error('笔记内容不可访问')
  return noteBlockUnits(resource.id, resource.revision, markdownBlocks(note.body))
}

export function getIndexRuntime(): IndexRuntime {
  if (!runtime) runtime = buildRuntime()
  return runtime
}

/** Mounts the runtime in the app shell: initial sync plus debounced updates. */
export function useIndexRuntime(): void {
  useEffect(() => {
    const current = getIndexRuntime()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void current.sync(), 400)
    }
    void current.sync()
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (!state.hydrated) return
      const changed =
        state.files !== previous.files ||
        state.notes !== previous.notes ||
        state.messages !== previous.messages ||
        state.resources !== previous.resources ||
        state.hydrated !== previous.hydrated
      if (changed) schedule()
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])
}

/**
 * Opens a search hit. Document hits go through the shared navigation service;
 * note and conversation hits reuse the existing view actions because the
 * navigation contract only covers documents today.
 */
export async function openSearchResult(result: SearchResult): Promise<void> {
  const state = useStore.getState()
  const resource = state.resources[result.resourceId]
  if (!resource) throw new Error('检索结果对应的资源不存在')
  if (resource.availability !== 'available') throw new Error('来源当前不可访问')

  if (resource.kind === 'document') {
    await state.navigation.navigateToSearchResult(result)
    return
  }
  if (resource.kind === 'note') {
    state.selectNote(resource.sourceId)
    state.setView('notes')
    return
  }
  state.setView('workspace')
  if (result.locator.type === 'message' && result.locator.messageId) {
    state.focusMessage(result.locator.messageId)
  }
}
