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
