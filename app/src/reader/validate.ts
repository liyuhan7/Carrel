// Runtime validation for annotations and selections. TypeScript types are not
// trusted at the persistence boundary: stored JSON may come from older builds.

import type { ContentSelector, Rect, ShapeGeometry } from '../shared/contracts/content'
import type { Annotation, AnnotationKind, AnnotationStyle, SelectionDraft } from '../shared/contracts/reader'
import { isRotation, normalizeRect } from './geometry.ts'

export const ANNOTATION_KINDS: AnnotationKind[] = [
  'highlight',
  'underline',
  'strikethrough',
  'note',
  'rect',
  'ellipse',
  'arrow',
  'ink'
]

export const TEXT_ANNOTATION_KINDS: AnnotationKind[] = ['highlight', 'underline', 'strikethrough']
export const SHAPE_ANNOTATION_KINDS: AnnotationKind[] = ['rect', 'ellipse', 'arrow', 'ink']

export const DEFAULT_TEXT_STYLE: AnnotationStyle = { color: '#d9c48f', opacity: 0.45 }
/** Style assigned to annotations imported from the legacy model. */
export const LEGACY_ANNOTATION_STYLE: AnnotationStyle = { ...DEFAULT_TEXT_STYLE }
export const DEFAULT_SHAPE_STYLE: AnnotationStyle = { color: '#a4685c', opacity: 1, strokeWidth: 2 }

export interface ValidationResult {
  ok: boolean
  reason?: string
}

const ok: ValidationResult = { ok: true }
const fail = (reason: string): ValidationResult => ({ ok: false, reason })

export function isAnnotationKind (value: unknown): value is AnnotationKind {
  return typeof value === 'string' && (ANNOTATION_KINDS as string[]).includes(value)
}

export function isTextKind (kind: AnnotationKind): boolean {
  return TEXT_ANNOTATION_KINDS.includes(kind)
}

export function isShapeKind (kind: AnnotationKind): boolean {
  return SHAPE_ANNOTATION_KINDS.includes(kind)
}

const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|lab|lch)a?\([0-9.,%\s/+-]+\)|[a-z]{3,24})$/i

export function validateStyle (style: unknown): ValidationResult {
  if (!style || typeof style !== 'object') return fail('标注样式缺失')
  const value = style as AnnotationStyle
  if (typeof value.color !== 'string' || !value.color.trim() || value.color.length > 40) {
    return fail('标注颜色无效')
  }
  if (!COLOR_PATTERN.test(value.color.trim())) return fail('标注颜色格式无效')
  if (value.opacity !== undefined) {
    if (typeof value.opacity !== 'number' || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) {
      return fail('标注透明度必须在 0 到 1 之间')
    }
  }
  if (value.strokeWidth !== undefined) {
    if (typeof value.strokeWidth !== 'number' || !Number.isFinite(value.strokeWidth) || value.strokeWidth <= 0 || value.strokeWidth > 64) {
      return fail('线宽无效')
    }
  }
  if (value.lineStyle !== undefined && !['solid', 'dashed', 'wavy'].includes(value.lineStyle)) {
    return fail('线型无效')
  }
  return ok
}

/** Plain-text body; note annotations require a non-empty one. */
export function validateBody (kind: AnnotationKind, body: string | undefined): ValidationResult {
  if (body === undefined) {
    return kind === 'note' ? fail('批注正文不能为空') : ok
  }
  if (typeof body !== 'string') return fail('批注正文必须是纯文本')
  if (body.length > 20000) return fail('批注正文过长')
  if (kind === 'note' && !body.trim()) return fail('批注正文不能为空')
  return ok
}

export function cleanBody (body: string | undefined): string | undefined {
  if (body === undefined) return undefined
  const trimmed = body.trim()
  return trimmed ? trimmed : undefined
}

function validateRects (rects: Rect[] | undefined): ValidationResult {
  if (rects === undefined) return ok
  if (!Array.isArray(rects)) return fail('标注矩形无效')
  for (const rect of rects) {
    if (!normalizeRect(rect)) return fail('标注矩形超出页面或面积为零')
  }
  return ok
}

function validateGeometry (geometry: ShapeGeometry | undefined): ValidationResult {
  if (!geometry || typeof geometry !== 'object') return fail('区域图形缺失')
  switch (geometry.type) {
    case 'rect':
    case 'ellipse':
      return normalizeRect(geometry.rect) ? ok : fail('区域矩形无效')
    case 'arrow': {
      const { from, to } = geometry
      if (!from || !to || from.length !== 2 || to.length !== 2) return fail('箭头端点无效')
      if (![...from, ...to].every((value) => typeof value === 'number' && Number.isFinite(value))) return fail('箭头端点无效')
      if (from[0] === to[0] && from[1] === to[1]) return fail('箭头长度为零')
      return ok
    }
    case 'ink': {
      if (!Array.isArray(geometry.points) || geometry.points.length < 2) return fail('手写轨迹点不足')
      if (!geometry.points.every((point) => point.length === 2 && point.every((value) => Number.isFinite(value)))) {
        return fail('手写轨迹点无效')
      }
      return ok
    }
    default:
      return fail('区域图形类型无效')
  }
}

export function validateSelector (selector: ContentSelector | undefined): ValidationResult {
  if (!selector || typeof selector !== 'object') return fail('标注位置缺失')
  switch (selector.type) {
    case 'document-text':
      if (!Number.isInteger(selector.page) || selector.page < 1) return fail('标注页码无效')
      if (!selector.quote || typeof selector.quote.exact !== 'string' || !selector.quote.exact.trim()) {
        return fail('标注引文不能为空')
      }
      if (selector.rotation !== undefined && !isRotation(selector.rotation)) return fail('页面旋转值无效')
      return validateRects(selector.rects)
    case 'document-region':
      if (!Number.isInteger(selector.page) || selector.page < 1) return fail('标注页码无效')
      if (selector.rotation !== undefined && !isRotation(selector.rotation)) return fail('页面旋转值无效')
      return validateGeometry(selector.geometry)
    case 'document-flow':
      if (!selector.quote || typeof selector.quote.exact !== 'string' || !selector.quote.exact.trim()) {
        return fail('标注引文不能为空')
      }
      return ok
    default:
      return ok
  }
}

export function validateSelection (selection: SelectionDraft): ValidationResult {
  if (!selection || typeof selection !== 'object') return fail('选区缺失')
  if (!selection.resourceId) return fail('选区缺少资料标识')
  if (!selection.revision) return fail('选区缺少资料版本')
  if (selection.kind === 'text') {
    if (selection.selector.type !== 'document-text' && selection.selector.type !== 'document-flow') {
      return fail('文本选区位置类型无效')
    }
    if (typeof selection.text !== 'string' || !selection.text.trim()) return fail('选区文字为空')
    return validateSelector(selection.selector)
  }
  if (selection.kind === 'region') {
    if (selection.selector.type !== 'document-region') return fail('区域选区位置类型无效')
    return validateSelector(selection.selector)
  }
  return fail('选区类型无效')
}

/** Text kinds need a text anchor; shape kinds need a region anchor; note accepts either. */
export function selectorMatchesKind (kind: AnnotationKind, selector: ContentSelector): boolean {
  if (isTextKind(kind)) return selector.type === 'document-text' || selector.type === 'document-flow'
  if (isShapeKind(kind)) return selector.type === 'document-region'
  return (
    selector.type === 'document-text' ||
    selector.type === 'document-flow' ||
    selector.type === 'document-region'
  )
}

export interface AnnotationDraftInput {
  selection: SelectionDraft
  kind: AnnotationKind
  style: AnnotationStyle
  body?: string
}

/** Validation shared by the service and the UI before anything is written. */
export function validateAnnotationDraft (input: AnnotationDraftInput): ValidationResult {
  const selection = validateSelection(input.selection)
  if (!selection.ok) return selection
  if (!isAnnotationKind(input.kind)) return fail('标注类型无效')
  if (!selectorMatchesKind(input.kind, input.selection.selector)) return fail('标注类型与选区不匹配')
  const style = validateStyle(input.style)
  if (!style.ok) return style
  return validateBody(input.kind, input.body)
}

export function validateAnnotation (annotation: Annotation): ValidationResult {  if (!annotation || typeof annotation !== 'object') return fail('标注数据无效')
  if (!annotation.id) return fail('标注缺少标识')
  if (!annotation.resourceId) return fail('标注缺少资料标识')
  if (!annotation.anchorId) return fail('标注缺少锚点')
  if (!isAnnotationKind(annotation.kind)) return fail('标注类型无效')
  const style = validateStyle(annotation.style)
  if (!style.ok) return style
  const body = validateBody(annotation.kind, annotation.body)
  if (!body.ok) return body
  if (!Number.isFinite(annotation.createdAt) || !Number.isFinite(annotation.updatedAt)) return fail('标注时间无效')
  return ok
}

/** Fill in defaults and reject invalid values; used on the write path only. */
export function normalizeStyle (style: AnnotationStyle | undefined, kind: AnnotationKind): AnnotationStyle {
  const base = isShapeKind(kind) ? { ...DEFAULT_SHAPE_STYLE } : { ...DEFAULT_TEXT_STYLE }
  const merged: AnnotationStyle = { ...base, ...(style ?? {}) }
  const result = validateStyle(merged)
  if (!result.ok) throw new Error(result.reason)
  return merged
}
