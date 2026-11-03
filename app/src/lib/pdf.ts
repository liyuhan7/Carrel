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

export { pdfjs }
