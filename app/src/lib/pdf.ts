import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDoc = PDFDocumentProxy

const docs = new Map<string, PdfDoc>()

export async function loadPdf (fileId: string, bytes: Uint8Array): Promise<PdfDoc> {
  const cached = docs.get(fileId)
  if (cached) return cached
  const doc = await pdfjs.getDocument({
    data: bytes,
    cMapUrl: 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'standard_fonts/'
  }).promise
  docs.set(fileId, doc)
  return doc
}

export function cachedPdf (fileId: string): PdfDoc | undefined {
  return docs.get(fileId)
}

// >>> integration:course-reading-annotation
/** Drop a cached document so an externally changed file is re-read from disk. */
export function dropPdf (fileId: string): void {
  const doc = docs.get(fileId)
  docs.delete(fileId)
  if (doc) void doc.destroy().catch(() => undefined)
}
// <<< integration:course-reading-annotation

export async function extractPageTexts (doc: PdfDoc): Promise<string[]> {
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if ('str' in item) {
        text += item.str
        if (item.hasEOL) text += '\n'
      }
    }
    pages.push(text)
    if (n % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return pages
}

export interface PageImage {
  mediaType: string
  data: string
  width: number
  height: number
}

/** Renders one page to a JPEG payload for vision models; null when the PDF is not loaded. */
export async function renderPageImage (fileId: string, page: number, maxWidth = 1280): Promise<PageImage | null> {
  const doc = cachedPdf(fileId)
  if (!doc) return null
  const pdfPage = await doc.getPage(page)
  const base = pdfPage.getViewport({ scale: 1 })
  const viewport = pdfPage.getViewport({ scale: Math.min(2, maxWidth / base.width) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
  const url = canvas.toDataURL('image/jpeg', 0.82)
  return {
    mediaType: 'image/jpeg',
    data: url.slice(url.indexOf(',') + 1),
    width: canvas.width,
    height: canvas.height
  }
}

export { pdfjs }
