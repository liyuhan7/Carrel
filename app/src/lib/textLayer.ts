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
  const range = selection.getRangeAt(0)
  if (!pageEl.contains(range.commonAncestorContainer)) return null
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (!text) return null
  const rects = rectsFromRange(pageEl, range)
  if (!rects.length) return null
  return { text, rects }
}
