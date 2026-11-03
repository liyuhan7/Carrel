// Map stored annotations to what the current document revision can actually show.
// Resolution is read-only: a relocated position is a display hint, never a
// silent rewrite of the Anchor's accepted position.

import type {
  Anchor,
  ContentSelector,
  Rect,
  ResolveStatus,
  ShapeGeometry
} from '../shared/contracts/content'
import type { Annotation, ResolvedAnnotation } from '../shared/contracts/reader'
import { convertGeometryRotation, convertRectRotation, geometryBounds, isRotation, normalizeRect } from './geometry.ts'
import type { Rotation } from './geometry.ts'
import { buildPageTextIndex, findQuoteOnPage, pickQuoteMatch } from './textMapping.ts'

export interface ResolveContext {
  /** Effective revision of the file currently on screen (content hash). */
  revision: string
  pageCount: number
  pageText(page: number): string | undefined
  /** Actual rotation for a rendered page; undefined means "not rendered, trust the selector". */
  rotationFor(page: number): Rotation | undefined
  anchorFor(anchorId: string): Anchor | undefined
  resourceAvailable: boolean
}

export const STATUS_LABEL: Record<ResolveStatus, string> = {
  ok: '定位正常',
  relocated: '已重新定位，待确认',
  ambiguous: '位置不唯一',
  orphaned: '原文已不存在',
  unlocatable: '无法自动定位',
  missing: '来源缺失'
}

export const STATUS_HINT: Record<ResolveStatus, string> = {
  ok: '',
  relocated: '文件版本已变化，按原文重新找到了候选位置；确认前不会覆盖原锚点。',
  ambiguous: '原文在同一页出现多次，无法确定是哪一处，因此不绘制。',
  orphaned: '当前文件中找不到这段原文，标注不再绘制。',
  unlocatable: '区域标注在文件版本变化后无法自动定位，需要重新框选。',
  missing: '标注或来源资料缺失，原始数据仍保留。'
}

/** Only confirmed or safely re-found positions are drawn. */
export function isRenderableStatus (status: ResolveStatus): boolean {
  return status === 'ok' || status === 'relocated'
}

const MAX_RELOCATE_PAGES = 60

function pageRange (pageCount: number): number[] {
  const total = Math.max(1, pageCount)
  return Array.from({ length: total }, (_value, index) => index + 1)
}

function searchOrder (preferred: number, pageCount: number): number[] {
  const total = Math.max(1, pageCount)
  const order: number[] = []
  const push = (page: number) => {
    if (page >= 1 && page <= total && !order.includes(page)) order.push(page)
  }
  push(preferred)
  push(preferred - 1)
  push(preferred + 1)
  for (const page of pageRange(pageCount)) push(page)
  return order.slice(0, MAX_RELOCATE_PAGES)
}

function findRelocatedQuote (
  selector: Extract<ContentSelector, { type: 'document-text' }>,
  context: ResolveContext
): { page: number; confidence: number } | 'ambiguous' | null {
  for (const page of searchOrder(selector.page, context.pageCount)) {
    const raw = context.pageText(page)
    if (!raw) continue
    const index = buildPageTextIndex(raw)
    const matches = findQuoteOnPage(page, index, selector.quote)
    if (!matches.length) continue
    const picked = pickQuoteMatch(matches)
    if (picked.ambiguous) return 'ambiguous'
    return { page, confidence: picked.confidence }
  }
  return null
}

function rectsForRotation (
  rects: Rect[] | undefined,
  from: number | undefined,
  to: Rotation | undefined
): Rect[] | undefined {
  if (!rects?.length) return undefined
  if (from === undefined || to === undefined || !isRotation(from) || from === to) {
    return rects.map((rect) => normalizeRect(rect)).filter((rect): rect is Rect => Boolean(rect))
  }
  return rects
    .map((rect) => normalizeRect(convertRectRotation(rect, from, to)))
    .filter((rect): rect is Rect => Boolean(rect))
}

function resolveText (
  annotation: Annotation,
  anchor: Anchor,
  selector: Extract<ContentSelector, { type: 'document-text' }>,
  context: ResolveContext
): ResolvedAnnotation {
  const sameRevision = anchor.accepted.revision === context.revision
  const rotation = context.rotationFor(selector.page)
  const rotationChanged =
    rotation !== undefined && selector.rotation !== undefined && isRotation(selector.rotation) && rotation !== selector.rotation
  const pageValid = selector.page >= 1 && selector.page <= Math.max(1, context.pageCount)

  if (sameRevision && pageValid && selector.rects?.length) {
    const rects = rectsForRotation(selector.rects, selector.rotation, rotation)
    if (rects?.length) {
      return {
        annotation,
        status: rotationChanged ? 'relocated' : 'ok',
        page: selector.page,
        rects,
        confidence: 1
      }
    }
  }

  const found = findRelocatedQuote(selector, context)
  if (found === 'ambiguous') {
    return { annotation, status: 'ambiguous', page: selector.page }
  }
  if (!found) {
    return { annotation, status: 'orphaned', page: pageValid ? selector.page : undefined }
  }

  const rects = sameRevision && found.page === selector.page
    ? rectsForRotation(selector.rects, selector.rotation, rotation)
    : undefined
  return {
    annotation,
    status: sameRevision && found.page === selector.page && !rotationChanged ? 'ok' : 'relocated',
    page: found.page,
    ...(rects?.length ? { rects } : {}),
    confidence: found.confidence
  }
}

function resolveRegion (
  annotation: Annotation,
  anchor: Anchor,
  selector: Extract<ContentSelector, { type: 'document-region' }>,
  context: ResolveContext
): ResolvedAnnotation {
  const pageValid = selector.page >= 1 && selector.page <= Math.max(1, context.pageCount)
  if (!pageValid || anchor.accepted.revision !== context.revision) {
    return { annotation, status: 'unlocatable', page: pageValid ? selector.page : undefined }
  }
  const geometry: ShapeGeometry = selector.geometry
  if (!geometryBounds(geometry)) {
    return { annotation, status: 'unlocatable', page: selector.page }
  }
  const rotation = context.rotationFor(selector.page)
  const rotationChanged =
    rotation !== undefined && selector.rotation !== undefined && isRotation(selector.rotation) && rotation !== selector.rotation
  return {
    annotation,
    status: rotationChanged ? 'relocated' : 'ok',
    page: selector.page,
    geometry: rotationChanged ? convertGeometryRotation(geometry, selector.rotation!, rotation!) : geometry,
    confidence: 1
  }
}

export function resolveAnnotation (annotation: Annotation, context: ResolveContext): ResolvedAnnotation {
  const anchor = context.anchorFor(annotation.anchorId)
  if (!anchor || !context.resourceAvailable) {
    return { annotation, status: 'missing' }
  }
  // Invariant: an annotation's resource must match its anchor's resource.
  if (anchor.resourceId !== annotation.resourceId) {
    return { annotation, status: 'missing' }
  }
  const selector = anchor.accepted.selector
  if (selector.type === 'document-text') return resolveText(annotation, anchor, selector, context)
  if (selector.type === 'document-region') return resolveRegion(annotation, anchor, selector, context)
  return { annotation, status: 'unlocatable' }
}

export function resolveAnnotations (annotations: Annotation[], context: ResolveContext): ResolvedAnnotation[] {
  return annotations.map((annotation) => resolveAnnotation(annotation, context))
}
