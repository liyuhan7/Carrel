// Visual annotation layer. Positions are normalised page coordinates scaled by
// the rendered page box, so zoom and window size never move a highlight.
// Invalid resolve states are never painted as valid highlights.

import type { Rect, ShapeGeometry } from '../../shared/contracts/content'
import type { ResolveStatus } from '../../shared/contracts/content'
import type { AnnotationKind, ResolvedAnnotation } from '../../shared/contracts/reader'
import { isRenderableStatus } from '../annotationResolve'
import { geometryBounds, rectCenter, rectToPixels } from '../geometry'

export interface AnnotationFilters {
  kinds: AnnotationKind[]
  colors: string[]
  statuses: ResolveStatus[]
}

export const ALL_FILTERS: AnnotationFilters = { kinds: [], colors: [], statuses: [] }

function passesFilters (item: ResolvedAnnotation, filters: AnnotationFilters): boolean {
  if (filters.kinds.length && !filters.kinds.includes(item.annotation.kind)) return false
  if (filters.colors.length && !filters.colors.includes(item.annotation.style.color)) return false
  if (filters.statuses.length && !filters.statuses.includes(item.status)) return false
  return true
}

/** Apply the display filters to a resolved list (used by overlay and sidebar). */
export function filterResolved (resolved: ResolvedAnnotation[], filters: AnnotationFilters): ResolvedAnnotation[] {
  return resolved.filter((item) => passesFilters(item, filters))
}

function textRects (item: ResolvedAnnotation): Rect[] {
  if (item.rects?.length) return item.rects
  if (item.geometry) {
    const bounds = geometryBounds(item.geometry)
    return bounds ? [bounds] : []
  }
  return []
}

interface OverlayProps {
  resolved: ResolvedAnnotation[]
  page: number
  pageWidth: number
  pageHeight: number
  visible: boolean
  filters: AnnotationFilters
  selectedId: string | null
  onSelect: (annotationId: string) => void
}

export function AnnotationOverlay ({
  resolved,
  page,
  pageWidth,
  pageHeight,
  visible,
  filters,
  selectedId,
  onSelect
}: OverlayProps) {
  if (!visible || !pageWidth || !pageHeight) return null
  const items = resolved.filter(
    (item) =>
      item.page === page &&
      isRenderableStatus(item.status) &&
      passesFilters(item, filters)
  )
  if (!items.length) return null

  return (
    <div className="anno-overlay">
      {items.map((item) => (
        <AnnotationShape
          key={item.annotation.id}
          item={item}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          selected={selectedId === item.annotation.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function AnnotationShape ({
  item,
  pageWidth,
  pageHeight,
  selected,
  onSelect
}: {
  item: ResolvedAnnotation
  pageWidth: number
  pageHeight: number
  selected: boolean
  onSelect: (annotationId: string) => void
}) {
  const { annotation, status } = item
  const color = annotation.style.color
  const opacity = annotation.style.opacity ?? (annotation.kind === 'highlight' ? 0.45 : 1)
  const strokeWidth = annotation.style.strokeWidth ?? 2
  const relocated = status === 'relocated'
  const className = [
    'anno-item-shape',
    `is-${annotation.kind}`,
    relocated ? 'is-relocated' : '',
    selected ? 'is-selected' : ''
  ].filter(Boolean).join(' ')
  const rects = textRects(item)

  if (annotation.kind === 'rect' || annotation.kind === 'ellipse' || annotation.kind === 'arrow' || annotation.kind === 'ink') {
    if (!item.geometry) return null
    return (
      <svg
        className={className}
        width={pageWidth}
        height={pageHeight}
        viewBox={`0 0 ${pageWidth} ${pageHeight}`}
        style={{ opacity }}
      >
        <GeometryShape
          geometry={item.geometry}
          color={color}
          strokeWidth={strokeWidth}
          dashed={relocated}
          width={pageWidth}
          height={pageHeight}
        />
      </svg>
    )
  }

  if (annotation.kind === 'note') {
    const bounds = rects[0] ?? (item.geometry ? geometryBounds(item.geometry) : null)
    if (!bounds) return null
    const center = rectCenter(bounds)
    return (
      <button
        type="button"
        className={`${className} anno-note-marker`}
        title={annotation.body || '批注'}
        aria-label={annotation.body ? `批注：${annotation.body.slice(0, 30)}` : '批注'}
        style={{
          left: center[0] * pageWidth,
          top: center[1] * pageHeight,
          borderColor: color,
          color
        }}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(annotation.id)
        }}
      >
        ✎
      </button>
    )
  }

  if (!rects.length) return null
  return (
    <>
      {rects.map((rect, index) => {
        const box = rectToPixels(rect, pageWidth, pageHeight)
        if (annotation.kind === 'underline') {
          return (
            <span
              key={index}
              className={`${className} anno-underline`}
              style={{
                left: box.left,
                top: box.top + box.height - Math.max(1, strokeWidth),
                width: box.width,
                borderBottom: `${strokeWidth}px solid ${color}`,
                opacity
              }}
            />
          )
        }
        if (annotation.kind === 'strikethrough') {
          return (
            <span
              key={index}
              className={`${className} anno-strike`}
              style={{
                left: box.left,
                top: box.top + box.height / 2,
                width: box.width,
                borderTop: `${Math.max(1, strokeWidth)}px solid ${color}`,
                opacity
              }}
            />
          )
        }
        return (
          <span
            key={index}
            className={`${className} anno-highlight`}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              background: relocated ? 'transparent' : color,
              border: relocated ? `1px dashed ${color}` : 'none',
              opacity: relocated ? 1 : opacity
            }}
          />
        )
      })}
    </>
  )
}

function GeometryShape ({
  geometry,
  color,
  strokeWidth,
  dashed,
  width,
  height
}: {
  geometry: ShapeGeometry
  color: string
  strokeWidth: number
  dashed: boolean
  width: number
  height: number
}) {
  const dash = dashed ? '4 3' : undefined
  const px = (value: number) => value * width
  const py = (value: number) => value * height
  switch (geometry.type) {
    case 'rect': {
      const [x, y, w, h] = geometry.rect
      return (
        <rect
          x={px(x)}
          y={py(y)}
          width={px(w)}
          height={py(h)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
        />
      )
    }
    case 'ellipse':
      return (
        <ellipse
          cx={px(geometry.rect[0] + geometry.rect[2] / 2)}
          cy={py(geometry.rect[1] + geometry.rect[3] / 2)}
          rx={px(geometry.rect[2] / 2)}
          ry={py(geometry.rect[3] / 2)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
        />
      )
    case 'arrow': {
      const [x1, y1] = [px(geometry.from[0]), py(geometry.from[1])]
      const [x2, y2] = [px(geometry.to[0]), py(geometry.to[1])]
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const head = Math.max(8, strokeWidth * 3)
      const spread = Math.PI / 7
      const points = [
        `${x2},${y2}`,
        `${x2 - head * Math.cos(angle - spread)},${y2 - head * Math.sin(angle - spread)}`,
        `${x2 - head * Math.cos(angle + spread)},${y2 - head * Math.sin(angle + spread)}`
      ].join(' ')
      return (
        <>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            strokeLinecap="round"
          />
          <polygon points={points} fill={color} />
        </>
      )
    }
    case 'ink':
      return (
        <polyline
          points={geometry.points.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dash}
        />
      )
  }
}
