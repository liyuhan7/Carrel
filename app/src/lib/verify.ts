import type { Citation } from '../types'

/**
 * Quote verification. The model proposes `@cite <page> | <quote>` lines; a
 * citation only becomes clickable evidence when the quote is found verbatim in
 * the page text we extracted ourselves. Punctuation and whitespace are ignored
 * so that full-width/half-width drift does not break a real match.
 */
export function normalize (input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

export interface ParsedAnswer {
  content: string
  citations: Citation[]
}

const CITE_LINE = /^[ \t]*@cite[ \t]+(\d+)[ \t]*[|｜][ \t]*(.+?)[ \t]*$/gim

export function parseAnswer (raw: string, pages: string[]): ParsedAnswer {
  const citations: Citation[] = []
  const seen = new Set<string>()

  for (const match of raw.matchAll(CITE_LINE)) {
    const page = Number(match[1])
    const quote = match[2].trim().replace(/^[「“"']|[」”"']$/g, '')
    if (!quote || quote.length < 4) continue
    const found = locateQuote(quote, pages, page)
    if (!found) continue
    const key = `${found.page}:${normalize(quote)}`
    if (seen.has(key)) continue
    seen.add(key)
    citations.push({
      page: found.page,
      quote,
      verified: true,
      corrected: found.page !== page
    })
  }

  const content = raw
    .replace(CITE_LINE, '')
    .replace(/^[ \t]*(引用原文|来源清单|参考来源|引用清单)[ \t]*[:：]?[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { content, citations }
}

/** Find the page that actually contains the quote. Cited page wins ties. */
export function locateQuote (quote: string, pages: string[], preferredPage?: number): { page: number } | null {
  const needle = normalize(quote)
  if (needle.length < 4) return null
  const order: number[] = []
  if (preferredPage && preferredPage >= 1 && preferredPage <= pages.length) order.push(preferredPage)
  for (let i = 1; i <= pages.length; i++) if (i !== preferredPage) order.push(i)
  for (const page of order) {
    if (normalize(pages[page - 1] || '').includes(needle)) return { page }
  }
  return null
}

export function stripInlineMarkers (text: string): string {
  return text.replace(/\[\[\s*p\s*(\d+)\s*\]\]/gi, '')
}
