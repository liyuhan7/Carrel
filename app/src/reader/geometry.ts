// Rect and shape geometry for paged documents.
// All coordinates are normalised to the page box *after* its intrinsic rotation
// (0..1), so zoom and window size never touch persisted positions.

import type { Point, Rect, ShapeGeometry } from '../shared/contracts/content'

export type Rotation = 0 | 90 | 180 | 270

export const ROTATIONS: Rotation[] = [0, 90, 180, 270]

export function isRotation (value: unknown): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export interface ClientBox {
  left: number
  top: number
  width: number
  height: number
}

/** Clamp a rectangle to the page box; returns null for zero-area or invalid input. */
export function normalizeRect (input: Rect | number[] | null | undefined): Rect | null {
  if (!input || input.length !== 4) return null
  const [x, y, width, height] = input
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null
  const left = clamp01(Math.min(x, x + width))
  const top = clamp01(Math.min(y, y + height))
  const right = clamp01(Math.max(x, x + width))
  const bottom = clamp01(Math.max(y, y + height))
  const rect: Rect = [left, top, right - left, bottom - top]
  if (rect[2] <= 0 || rect[3] <= 0) return null
  return rect
}

export function rectArea (rect: Rect): number {
  return Math.max(0, rect[2]) * Math.max(0, rect[3])
}

export function rectCenter (rect: Rect): Point {
  return [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2]
}

export function rectContainsPoint (rect: Rect, point: Point, padding = 0): boolean {
  return (
    point[0] >= rect[0] - padding &&
    point[0] <= rect[0] + rect[2] + padding &&
    point[1] >= rect[1] - padding &&
    point[1] <= rect[1] + rect[3] + padding
  )
}

export function unionRects (rects: Rect[]): Rect | null {
  const valid = rects.map((rect) => normalizeRect(rect)).filter((rect): rect is Rect => Boolean(rect))
  if (!valid.length) return null
  let left = 1
  let top = 1
  let right = 0
  let bottom = 0
  for (const rect of valid) {
    left = Math.min(left, rect[0])
    top = Math.min(top, rect[1])
    right = Math.max(right, rect[0] + rect[2])
    bottom = Math.max(bottom, rect[1] + rect[3])
  }
  return normalizeRect([left, top, right - left, bottom - top])
}

/** Convert one client rect into page-normalised coordinates. */
export function rectFromClient (page: ClientBox, client: ClientBox): Rect | null {
  if (!page.width || !page.height) return null
  if (!finite(client.left) || !finite(client.top) || !finite(client.width) || !finite(client.height)) return null
  if (client.width <= 1 || client.height <= 1) return null
  return normalizeRect([
    (client.left - page.left) / page.width,
    (client.top - page.top) / page.height,
    client.width / page.width,
    client.height / page.height
  ])
}

/** Multi-line selections become one rectangle per client rect; empty ones are dropped. */
export function rectsFromClient (page: ClientBox, clients: Iterable<ClientBox>): Rect[] {
  const rects: Rect[] = []
  for (const client of clients) {
    const rect = rectFromClient(page, client)
    if (rect) rects.push(rect)
  }
  return rects
}

export function pointFromClient (page: ClientBox, clientX: number, clientY: number): Point {
  if (!page.width || !page.height) return [0, 0]
  return [clamp01((clientX - page.left) / page.width), clamp01((clientY - page.top) / page.height)]
}

/** Pixel rectangle inside a rendered page box; used by the visual overlay. */
export function rectToPixels (rect: Rect, width: number, height: number): { left: number; top: number; width: number; height: number } {
  return { left: rect[0] * width, top: rect[1] * height, width: rect[2] * width, height: rect[3] * height }
}

/**
 * Rotation mapping. A page box rotated clockwise by R shows intrinsic (u, v)
 * at (x, y); converting between two rotations goes through intrinsic space.
 */
function toUnrotated (point: Point, rotation: Rotation): Point {
  const [x, y] = point
  switch (rotation) {
    case 0: return [x, y]
    case 90: return [y, 1 - x]
    case 180: return [1 - x, 1 - y]
    case 270: return [1 - y, x]
  }
}

function fromUnrotated (point: Point, rotation: Rotation): Point {
  const [u, v] = point
  switch (rotation) {
    case 0: return [u, v]
    case 90: return [1 - v, u]
    case 180: return [1 - u, 1 - v]
    case 270: return [v, 1 - u]
  }
}

export function convertPointRotation (point: Point, from: Rotation, to: Rotation): Point {
  if (from === to) return [point[0], point[1]]
  const intrinsic = toUnrotated(point, from)
  return fromUnrotated(intrinsic, to)
}

export function convertRectRotation (rect: Rect, from: Rotation, to: Rotation): Rect {
  if (from === to) return rect
  const a = convertPointRotation([rect[0], rect[1]], from, to)
  const b = convertPointRotation([rect[0] + rect[2], rect[1] + rect[3]], from, to)
  return normalizeRect([a[0], a[1], b[0] - a[0], b[1] - a[1]]) ?? [0, 0, 0, 0]
}

export function convertGeometryRotation (geometry: ShapeGeometry, from: Rotation, to: Rotation): ShapeGeometry {
  if (from === to) return geometry
  switch (geometry.type) {
    case 'rect':
    case 'ellipse':
      return { type: geometry.type, rect: convertRectRotation(geometry.rect, from, to) }
    case 'arrow':
      return {
        type: 'arrow',
        from: convertPointRotation(geometry.from, from, to),
        to: convertPointRotation(geometry.to, from, to)
      }
    case 'ink':
      return { type: 'ink', points: geometry.points.map((point) => convertPointRotation(point, from, to)) }
  }
}

/** Bounding rectangle used for hit testing and note markers. */
export function geometryBounds (geometry: ShapeGeometry): Rect | null {
  switch (geometry.type) {
    case 'rect':
    case 'ellipse':
      return normalizeRect(geometry.rect)
    case 'arrow': {
      const [x1, y1] = geometry.from
      const [x2, y2] = geometry.to
      return normalizeRect([Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)])
    }
    case 'ink': {
      if (!geometry.points.length) return null
      let minX = 1
      let minY = 1
      let maxX = 0
      let maxY = 0
      for (const [x, y] of geometry.points) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      return normalizeRect([minX, minY, maxX - minX, maxY - minY])
    }
  }
}

/** A clickable rectangle for every kind of shape. */
export function geometryToRects (geometry: ShapeGeometry): Rect[] {
  if (geometry.type === 'ink') return geometry.points.length ? (geometryBounds(geometry) ? [geometryBounds(geometry)!] : []) : []
  const bounds = geometryBounds(geometry)
  return bounds ? [bounds] : []
}
