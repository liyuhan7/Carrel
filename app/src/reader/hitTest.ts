// Point hit testing over resolved annotations. Text selection stays untouched;
// the reader calls this only for a collapsed click, then offers every overlap.

import type { Point } from '../shared/contracts/content'
import type { ResolvedAnnotation } from '../shared/contracts/reader'
import { geometryBounds, rectArea, rectContainsPoint, unionRects } from './geometry.ts'
import { isRenderableStatus } from './annotationResolve.ts'

export interface HitOptions {
  /** Extra tolerance in normalised page units (about one text line). */
  padding?: number
  limit?: number
}

function boundsOf (item: ResolvedAnnotation) {
  if (item.rects?.length) return unionRects(item.rects)
  if (item.geometry) return geometryBounds(item.geometry)
  return null
}

/** Smallest visible annotation under the point first; ties keep creation order. */
export function hitTestAnnotations (
  point: Point,
  resolved: ResolvedAnnotation[],
  options: HitOptions = {}
): ResolvedAnnotation[] {
  const padding = options.padding ?? 0.004
  const hits: Array<{ item: ResolvedAnnotation; area: number }> = []
  for (const item of resolved) {
    if (!isRenderableStatus(item.status)) continue
    const bounds = boundsOf(item)
    if (!bounds) continue
    if (!rectContainsPoint(bounds, point, padding)) continue
    hits.push({ item, area: rectArea(bounds) })
  }
  hits.sort((a, b) => a.area - b.area)
  return hits.slice(0, options.limit ?? 8).map((hit) => hit.item)
}

/** Overlap test used for click-through protection of note markers. */
export function annotationsAtPoint (point: Point, resolved: ResolvedAnnotation[]): ResolvedAnnotation[] {
  return hitTestAnnotations(point, resolved)
}
