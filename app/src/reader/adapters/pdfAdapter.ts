// PDF paged adapter: revision, selection capture, page model and projection.
// The adapter owns no state; the rendered page element is attached by PdfViewer.

import type { ContentSelector, Point, Rect } from '../../shared/contracts/content'
import type {
  AdapterCapabilities,
  PageModel,
  PagedAdapter,
  ReaderLocation,
  SelectionDraft
} from '../../shared/contracts/reader'
import { cachedPdf } from '../../lib/pdf'
import { locateQuoteRects, rectsFromRange } from '../../lib/textLayer'
import type { Rotation } from '../geometry.ts'
import { geometryBounds, isRotation, normalizeRect, pointFromClient, rectFromClient } from '../geometry.ts'
import { buildPageTextIndex, extractQuote, findQuoteCandidates, normalizeForMatch } from '../textMapping.ts'

export interface PdfPageHandle {
  page: number
  rotation: Rotation
  element: HTMLElement
}

export interface PdfAdapterDeps {
  resourceId: string
  fileId: string
  /** Effective content revision: the file hash recorded by the library. */
  revision(): string
  pageText(page: number): string | undefined
  pageCount(): number
  goToPage(page: number): void
  flashQuote(page: number, quote: string): void
}

export interface PdfAdapter extends PagedAdapter {
  attach(handle: PdfPageHandle | null): void
  attached(): PdfPageHandle | null
}

function normaliseRotation (value: number): Rotation {
  const rounded = ((Math.round(value / 90) * 90) % 360 + 360) % 360
  return isRotation(rounded) ? rounded : 0
}

/** Normalised offset of a DOM boundary measured from the start of the text layer. */
function normalizedOffsetWithin (layer: HTMLElement, node: Node, offset: number): number | null {
  try {
    const range = document.createRange()
    range.selectNodeContents(layer)
    range.setEnd(node, offset)
    return normalizeForMatch(range.toString()).length
  } catch {
    return null
  }
}

export function createPdfAdapter (deps: PdfAdapterDeps): PdfAdapter {
  let handle: PdfPageHandle | null = null

  const capabilities = (location?: ReaderLocation): AdapterCapabilities => {
    const page = location?.kind === 'page' ? location.page : handle?.page ?? 1
    const text = deps.pageText(page)
    return {
      textSelection: Boolean(text?.trim()),
      regionSelection: true,
      shapes: true,
      comments: true,
      textSearch: true,
      reflow: false
    }
  }

  return {
    resourceId: deps.resourceId,

    get pageCount () {
      return deps.pageCount()
    },

    attach (next) {
      handle = next
    },

    attached () {
      return handle
    },

    getCapabilities: capabilities,

    async getRevision () {
      return deps.revision()
    },

    captureSelection (): SelectionDraft | null {
      const current = handle
      if (!current) return null
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null
      const range = selection.getRangeAt(0)
      if (!current.element.contains(range.commonAncestorContainer)) return null
      const text = selection.toString().replace(/\s+/g, ' ').trim()
      if (!text) return null
      const rects = rectsFromRange(current.element, range)
      if (!rects.length) return null

      const raw = deps.pageText(current.page) ?? ''
      const pageIndex = raw ? buildPageTextIndex(raw) : null
      const needle = normalizeForMatch(text)
      let quote = { exact: text }

      if (pageIndex && needle) {
        // The text layer and the extracted page text normally agree after
        // normalisation; the DOM offset then gives the exact raw position.
        const start = normalizedOffsetWithin(current.element, range.startContainer, range.startOffset)
        const end = normalizedOffsetWithin(current.element, range.endContainer, range.endOffset)
        let rawStart: number | null = null
        let rawEnd: number | null = null
        if (start !== null && end !== null && end > start) {
          const sameSlice = pageIndex.normalized.slice(start, end) === needle
          if (sameSlice) {
            rawStart = pageIndex.normalizedToRaw[start]
            rawEnd = pageIndex.normalizedToRaw[end - 1] + 1
          } else {
            const candidates = findQuoteCandidates(pageIndex, text, { limit: 16 })
            const nearest = candidates
              .slice()
              .sort((a, b) => Math.abs(a.normalizedStart - start) - Math.abs(b.normalizedStart - start))[0]
            if (nearest) {
              rawStart = nearest.rawStart
              rawEnd = nearest.rawEnd
            }
          }
        }
        if (rawStart !== null && rawEnd !== null && rawEnd > rawStart) {
          quote = extractQuote(raw, rawStart, rawEnd)
        }
      }

      const selector: Extract<ContentSelector, { type: 'document-text' }> = {
        type: 'document-text',
        page: current.page,
        quote,
        rects,
        rotation: current.rotation
      }
      return {
        kind: 'text',
        resourceId: deps.resourceId,
        revision: deps.revision(),
        selector,
        text
      }
    },

    captureRegion (page: number, rect: Rect): SelectionDraft {
      const rotation = handle && handle.page === page ? handle.rotation : 0
      const normalized = normalizeRect(rect) ?? [0, 0, 0.01, 0.01]
      return {
        kind: 'region',
        resourceId: deps.resourceId,
        revision: deps.revision(),
        selector: {
          type: 'document-region',
          page,
          geometry: { type: 'rect', rect: normalized },
          rotation
        }
      }
    },

    async getPage (page: number): Promise<PageModel> {
      const doc = cachedPdf(deps.fileId)
      if (!doc) throw new Error('PDF 尚未加载')
      const pdfPage = await doc.getPage(page)
      const viewport = pdfPage.getViewport({ scale: 1 })
      const text = deps.pageText(page)
      return {
        page,
        width: viewport.width,
        height: viewport.height,
        rotation: normaliseRotation(viewport.rotation),
        hasText: Boolean(text?.trim()),
        ...(text !== undefined ? { text } : {})
      }
    },

    async projectToViewport (selector: ContentSelector): Promise<Rect[] | null> {
      const current = handle
      if (!current) return null
      if (selector.type === 'document-text') {
        if (selector.page !== current.page) return null
        const rects = locateQuoteRects(current.element, selector.quote.exact)
        return rects.length ? rects : null
      }
      if (selector.type === 'document-region') {
        if (selector.page !== current.page) return null
        const bounds = geometryBounds(selector.geometry)
        return bounds ? [bounds] : null
      }
      return null
    },

    async focusResolved (selector: ContentSelector): Promise<boolean> {
      if (selector.type === 'document-text' || selector.type === 'document-region') {
        deps.goToPage(selector.page)
        if (selector.type === 'document-text') deps.flashQuote(selector.page, selector.quote.exact)
        return true
      }
      return false
    }
  }
}

/** Convert a client point inside a rendered page into normalised page coordinates. */
export function pagePointFromClient (element: HTMLElement, clientX: number, clientY: number): Point {
  const box = element.getBoundingClientRect()
  return pointFromClient(box, clientX, clientY)
}

/** Convert one client rect inside a rendered page into normalised page coordinates. */
export function pageRectFromClient (element: HTMLElement, client: DOMRect): Rect | null {
  return rectFromClient(element.getBoundingClientRect(), client)
}
