// Per-resource reading state: page, zoom, layout, scroll ratio and display flag.
// Pure helpers; persistence lives in the store.

import type { ReadingState } from '../shared/contracts/reader'

export const MIN_ZOOM = 0.6
export const MAX_ZOOM = 3
export const DEFAULT_ZOOM = 1
/** PDF pages are stacked in one scroll container, so scrolling turns pages. */
export const DEFAULT_LAYOUT: ReadingState['layout'] = 'continuous'

export function clampZoom (zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Page numbers are 1-based and must fall back to the last valid page. */
export function clampPage (page: number, pageCount: number): number {
  const total = Math.max(1, Math.round(pageCount || 1))
  if (!Number.isFinite(page)) return 1
  return Math.min(total, Math.max(1, Math.round(page)))
}

export function clampScrollRatio (ratio: number | undefined): number | undefined {
  if (ratio === undefined || !Number.isFinite(ratio)) return undefined
  return Math.min(1, Math.max(0, ratio))
}

export function createReadingState (input: {
  resourceId: string
  page?: number
  zoom?: number
  layout?: ReadingState['layout']
  showAnnotations?: boolean
  scrollRatio?: number
  courseId?: string
  now?: number
}): ReadingState {
  const now = input.now ?? Date.now()
  return {
    resourceId: input.resourceId,
    ...(input.courseId ? { courseId: input.courseId } : {}),
    location: {
      kind: 'page',
      page: Math.max(1, Math.round(input.page ?? 1)),
      ...(clampScrollRatio(input.scrollRatio) !== undefined ? { scrollRatio: clampScrollRatio(input.scrollRatio) } : {})
    },
    zoom: clampZoom(input.zoom ?? DEFAULT_ZOOM),
    layout: input.layout ?? DEFAULT_LAYOUT,
    showAnnotations: input.showAnnotations ?? true,
    lastOpenedAt: now,
    updatedAt: now
  }
}

export interface ReadingStatePatch {
  location?: Partial<ReadingState['location']>
  zoom?: number
  layout?: ReadingState['layout']
  showAnnotations?: boolean
  courseId?: string
  lastOpenedAt?: number
}

/** Merge a patch without dropping the scroll ratio when only the page changes. */
export function patchReadingState (previous: ReadingState, patch: ReadingStatePatch, now = Date.now()): ReadingState {
  const location = { ...previous.location, ...(patch.location ?? {}) }
  if (location.kind === 'page') {
    location.page = Math.max(1, Math.round(location.page ?? 1))
    const ratio = clampScrollRatio(location.scrollRatio)
    if (ratio === undefined) delete location.scrollRatio
    else location.scrollRatio = ratio
  }
  return {
    ...previous,
    ...(patch.courseId !== undefined ? { courseId: patch.courseId } : {}),
    location,
    zoom: patch.zoom === undefined ? previous.zoom : clampZoom(patch.zoom),
    layout: patch.layout ?? previous.layout,
    showAnnotations: patch.showAnnotations ?? previous.showAnnotations,
    lastOpenedAt: patch.lastOpenedAt ?? previous.lastOpenedAt,
    updatedAt: now
  }
}

/** Re-validate persisted values, including a document whose page count shrank. */
export function clampReadingState (state: ReadingState, pageCount: number, now = Date.now()): ReadingState {
  const page = clampPage(state.location?.page ?? 1, pageCount)
  const location = state.location?.kind === 'flow'
    ? { ...state.location }
    : { kind: 'page' as const, page }
  if (location.kind === 'page') {
    const ratio = clampScrollRatio(location.scrollRatio)
    if (ratio === undefined) delete location.scrollRatio
    else location.scrollRatio = ratio
  }
  return {
    ...state,
    location,
    zoom: clampZoom(state.zoom),
    // Stored states predate the continuous reader; the PDF view is continuous now.
    layout: DEFAULT_LAYOUT,
    showAnnotations: state.showAnnotations !== false,
    updatedAt: now
  }
}

/** Legacy `workspace.pages` / `workspace.zoom` read-through when no new state exists. */
export function legacyReadingState (input: {
  resourceId: string
  page?: number
  zoom?: number
  now?: number
}): ReadingState | null {
  if (!input.resourceId) return null
  if (input.page === undefined && input.zoom === undefined) return null
  return createReadingState({
    resourceId: input.resourceId,
    page: input.page,
    zoom: input.zoom,
    now: input.now
  })
}

export function readingStatePage (state: ReadingState | undefined): number {
  if (!state || state.location.kind !== 'page') return 1
  return clampPage(state.location.page ?? 1, Number.MAX_SAFE_INTEGER)
}
