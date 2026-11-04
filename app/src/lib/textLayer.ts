import { normalize } from './verify'
import type { Rect } from '../types'

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function rectsFromRange (pageEl: HTMLElement, range: Range): Rect[] {
  const box = pageEl.getBoundingClientRect()
  if (!box.width || !box.height) return []
  return Array.from(range.getClientRects())
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => [
      clamp01((r.left - box.left) / box.width),
      clamp01((r.top - box.top) / box.height),
      clamp01(r.width / box.width),
      clamp01(r.height / box.height)
    ])
}

/** The rendered page box that owns a DOM node (pages are stacked in one scroll container). */
export function pageElementOf (node: Node | null | undefined): HTMLElement | null {
  if (!node) return null
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return element?.closest<HTMLElement>('[data-pdf-page]') ?? null
}

/**
 * Clip a selection range to one page's text layer. A drag that runs past the
 * page edge still belongs to the page it started on, and must not produce
 * rectangles from the neighbouring page.
 */
export function rangeWithinPage (range: Range, pageEl: HTMLElement): Range | null {
  const boundary = pageEl.querySelector<HTMLElement>('.textLayer') ?? pageEl
  const startInside = boundary.contains(range.startContainer)
  const endInside = boundary.contains(range.endContainer)
  if (!startInside && !endInside) return null
  const scoped = range.cloneRange()
  if (!startInside) scoped.setStart(boundary, 0)
  if (!endInside) scoped.setEnd(boundary, boundary.childNodes.length)
  return scoped
}

/**
 * Map a quote back to rectangles in the rendered text layer, so a note
 * reference or a verified citation can actually flash the passage it cites.
 */
export function locateQuoteRects (pageEl: HTMLElement, quote: string): Rect[] {
  const needle = normalize(quote)
  if (!needle) return []
  let flat = ''
  const chars: { node: Node; offset: number }[] = []

  for (const span of pageEl.querySelectorAll<HTMLElement>('.textLayer span')) {
    const node = span.firstChild
    if (!node || node.nodeType !== Node.TEXT_NODE) continue
    const text = node.textContent || ''
    for (let i = 0; i < text.length; i++) {
      const ch = normalize(text[i])
      if (!ch) continue
      flat += ch
      chars.push({ node, offset: i })
    }
  }

  const at = flat.indexOf(needle)
  if (at < 0) return []
  const start = chars[at]
  const end = chars[at + needle.length - 1]
  if (!start || !end) return []

  const range = document.createRange()
  try {
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset + 1)
  } catch {
    return []
  }
  return rectsFromRange(pageEl, range)
}

export function pageTextSelection (pageEl: HTMLElement): { text: string; rects: Rect[] } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const scoped = rangeWithinPage(selection.getRangeAt(0), pageEl)
  if (!scoped) return null
  const text = scoped.toString().replace(/\s+/g, ' ').trim()
  if (!text) return null
  const rects = rectsFromRange(pageEl, scoped)
  if (!rects.length) return null
  return { text, rects }
}

/**
 * The text layer is a flat list of absolutely positioned spans, so a point in
 * the page margin belongs to no line and the browser resolves the caret into
 * the middle of the layer. Pick the line nearest the pointer instead.
 */
function nearestTextLine (pageEl: HTMLElement, clientY: number): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const span of pageEl.querySelectorAll<HTMLElement>('.textLayer span')) {
    if (!(span.textContent || '').trim()) continue
    const box = span.getBoundingClientRect()
    if (!box.width || !box.height) continue
    if (clientY >= box.top && clientY <= box.bottom) return span
    const distance = Math.abs(box.top + box.height / 2 - clientY)
    if (distance < bestDistance) {
      bestDistance = distance
      best = span
    }
  }
  return best
}

function insideTextRun (node: Node | null | undefined): boolean {
  if (!node) return false
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return Boolean(element?.closest('.textLayer span'))
}

/**
 * Where a point outside the text should land on a line: above it means the
 * line start, below it the line end, and level with it the nearer edge.
 */
function endpointTarget (
  pageEl: HTMLElement,
  point: { x: number; y: number }
): { node: Node; offset: number } | null {
  const line = nearestTextLine(pageEl, point.y)
  if (!line) return null
  const node = line.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const length = (node.textContent || '').length
  const box = line.getBoundingClientRect()
  let offset = 0
  if (point.y > box.bottom) offset = length
  else if (point.y >= box.top) offset = point.x < box.left + box.width / 2 ? 0 : length
  return { node, offset }
}

/** A character position inside a rendered page. */
export interface TextTarget {
  node: Node
  offset: number
}

/** Exact caret inside a text run, or null when the point is over no text. */
function caretInTextRun (
  point: { x: number; y: number }
): TextTarget | null {
  const caret = document.caretRangeFromPoint?.(point.x, point.y)
  if (!caret) return null
  if (!insideTextRun(caret.startContainer)) return null
  return { node: caret.startContainer, offset: caret.startOffset }
}

/**
 * Resolve a pointer position to a text position. Inside a run this is the exact
 * caret; in the page margin or between lines it falls back to the nearest line
 * edge, so a drag never jumps to a whole line.
 */
export function textTargetAt (pageEl: HTMLElement, point: { x: number; y: number }): TextTarget | null {
  return caretInTextRun(point) ?? endpointTarget(pageEl, point)
}

/**
 * Paint a selection from a drag anchor to the pointer. `setBaseAndExtent` keeps
 * the direction the user dragged, so a left-to-right drag never reads as
 * right-to-left.
 */
export function setTextSelection (anchor: TextTarget, focus: TextTarget): boolean {
  const selection = window.getSelection()
  if (!selection) return false
  try {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
    return true
  } catch {
    try {
      const range = document.createRange()
      range.setStart(anchor.node, anchor.offset)
      range.setEnd(focus.node, focus.offset)
      selection.removeAllRanges()
      selection.addRange(range)
      return true
    } catch {
      return false
    }
  }
}

/** The word around a caret, using the platform word segmentation (works for CJK too). */
export function wordTargets (target: TextTarget): { start: TextTarget; end: TextTarget } {
  const node = target.node
  const text = node.textContent || ''
  const offset = Math.min(Math.max(0, target.offset), text.length)
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return { start: target, end: target }
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  const segments = [...segmenter.segment(text)]
  let index = segments.findIndex((segment) => offset >= segment.index && offset < segment.index + segment.segment.length)
  if (index < 0) index = segments.length - 1
  // A double click next to a gap takes the word beside it, not the whole line.
  if (!segments[index]?.segment.trim()) {
    if (segments[index + 1]?.segment.trim()) index += 1
    else if (segments[index - 1]?.segment.trim()) index -= 1
  }
  const chosen = segments[index]
  if (!chosen) return { start: target, end: target }
  return {
    start: { node, offset: chosen.index },
    end: { node, offset: chosen.index + chosen.segment.length }
  }
}

/** The whole text run (one rendered line) around a caret, for triple click. */
export function lineTargets (target: TextTarget): { start: TextTarget; end: TextTarget } {
  const element = target.node.nodeType === Node.ELEMENT_NODE ? (target.node as Element) : target.node.parentElement
  const span = element?.closest('.textLayer span')
  const text = span?.firstChild
  if (!text || text.nodeType !== Node.TEXT_NODE) return { start: target, end: target }
  return { start: { node: text, offset: 0 }, end: { node: text, offset: (text.textContent || '').length } }
}

/**
 * Rebuild a selection whose endpoints left the text, using the drag itself:
 * `anchor` is where it began, `focus` where it ended. A range that stays inside
 * the text is left alone, so word/line selection and programmatic ranges are
 * untouched. Returns true when the range changed.
 */
export function snapSelectionToLine (
  pageEl: HTMLElement,
  range: Range,
  anchor: { x: number; y: number },
  focus: { x: number; y: number }
): boolean {
  if (insideTextRun(range.startContainer) && insideTextRun(range.endContainer)) return false
  const anchorInText = Boolean(caretInTextRun(anchor))
  const focusInText = Boolean(caretInTextRun(focus))
  if (anchorInText && focusInText) return false
  const forward = anchor.y < focus.y - 0.5 || (Math.abs(anchor.y - focus.y) <= 0.5 && anchor.x <= focus.x)
  const start = textTargetAt(pageEl, forward ? anchor : focus)
  const end = textTargetAt(pageEl, forward ? focus : anchor)
  if (!start || !end) return false
  try {
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
  } catch {
    return false
  }
  return true
}

