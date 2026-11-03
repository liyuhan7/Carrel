// Page text normalisation with a reversible character map, plus quote matching.
// PDF `getTextContent()` and the DOM text layer split text differently, so we
// never compare their strings directly: both sides normalise through this module.

import type { TextQuote } from '../shared/contracts/content'

export interface PageTextIndex {
  raw: string
  normalized: string
  /** normalized[i] came from raw[normalizedToRaw[i]]. */
  normalizedToRaw: number[]
}

const STRIP = /[\s\p{P}\p{S}]/u

/** NFKC + lowercase, dropping whitespace, punctuation and symbols (same rule as citation checks). */
export function normalizeChar (char: string): string {
  const folded = char.normalize('NFKC').toLowerCase()
  let out = ''
  for (const item of folded) {
    if (!STRIP.test(item)) out += item
  }
  return out
}

export function normalizeWithMap (raw: string): { normalized: string; map: number[] } {
  let normalized = ''
  const map: number[] = []
  for (let index = 0; index < raw.length; index++) {
    const folded = normalizeChar(raw[index])
    for (const char of folded) {
      normalized += char
      map.push(index)
    }
  }
  return { normalized, map }
}

export function normalizeForMatch (raw: string): string {
  return normalizeWithMap(raw).normalized
}

export function buildPageTextIndex (raw: string): PageTextIndex {
  const { normalized, map } = normalizeWithMap(raw)
  return { raw, normalized, normalizedToRaw: map }
}

function tailMatch (haystack: string, needle: string): number {
  const target = normalizeForMatch(needle)
  if (!target) return 0
  let matched = 0
  while (
    matched < target.length &&
    matched < haystack.length &&
    haystack[haystack.length - 1 - matched] === target[target.length - 1 - matched]
  ) {
    matched++
  }
  return matched / target.length
}

function headMatch (haystack: string, needle: string): number {
  const target = normalizeForMatch(needle)
  if (!target) return 0
  let matched = 0
  while (matched < target.length && matched < haystack.length && haystack[matched] === target[matched]) {
    matched++
  }
  return matched / target.length
}

export interface QuoteCandidate {
  rawStart: number
  rawEnd: number
  normalizedStart: number
  /** Prefix/suffix agreement, 0..1. A match without context scores 0.5. */
  contextScore: number
}

export interface QuoteSearchOptions {
  prefix?: string
  suffix?: string
  limit?: number
}

/** All occurrences of a quote on one page, best context first. */
export function findQuoteCandidates (
  index: PageTextIndex,
  exact: string,
  options: QuoteSearchOptions = {}
): QuoteCandidate[] {
  const needle = normalizeForMatch(exact)
  if (!needle) return []
  const limit = options.limit ?? 32
  const candidates: QuoteCandidate[] = []
  let from = 0
  while (candidates.length < limit) {
    const at = index.normalized.indexOf(needle, from)
    if (at < 0) break
    const rawStart = index.normalizedToRaw[at]
    const rawEnd = index.normalizedToRaw[at + needle.length - 1] + 1
    const before = index.normalized.slice(0, at)
    const after = index.normalized.slice(at + needle.length)
    const prefixScore = options.prefix ? tailMatch(before, options.prefix) : 0.5
    const suffixScore = options.suffix ? headMatch(after, options.suffix) : 0.5
    candidates.push({
      rawStart,
      rawEnd,
      normalizedStart: at,
      contextScore: prefixScore * 0.5 + suffixScore * 0.5
    })
    from = at + Math.max(1, needle.length)
  }
  candidates.sort((a, b) => b.contextScore - a.contextScore || a.rawStart - b.rawStart)
  return candidates
}

/** Build a TextQuote from raw page offsets; the exact text keeps its original glyphs. */
export function extractQuote (raw: string, rawStart: number, rawEnd: number, contextLength = 24): TextQuote {
  const start = Math.max(0, Math.min(raw.length, rawStart))
  const end = Math.max(start, Math.min(raw.length, rawEnd))
  const exact = raw.slice(start, end)
  const prefix = raw.slice(Math.max(0, start - contextLength), start).replace(/\s+/g, ' ').trim()
  const suffix = raw.slice(end, Math.min(raw.length, end + contextLength)).replace(/\s+/g, ' ').trim()
  return {
    exact,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {})
  }
}

export interface PageQuoteMatch extends QuoteCandidate {
  page: number
}

export function findQuoteOnPage (
  page: number,
  index: PageTextIndex,
  quote: TextQuote,
  limit?: number
): PageQuoteMatch[] {
  return findQuoteCandidates(index, quote.exact, { prefix: quote.prefix, suffix: quote.suffix, limit })
    .map((candidate) => ({ ...candidate, page }))
}

export interface PickedQuote {
  match: PageQuoteMatch | null
  /** Two or more equally good positions: do not guess. */
  ambiguous: boolean
  confidence: number
}

/** Choose one candidate; near-equal context scores mean the position is ambiguous. */
export function pickQuoteMatch (matches: PageQuoteMatch[]): PickedQuote {
  if (!matches.length) return { match: null, ambiguous: false, confidence: 0 }
  const sorted = [...matches].sort((a, b) => b.contextScore - a.contextScore || a.rawStart - b.rawStart)
  const top = sorted[0]
  const second = sorted[1]
  const ambiguous = Boolean(second) && Math.abs(second.contextScore - top.contextScore) < 0.02
  return { match: top, ambiguous, confidence: top.contextScore }
}

export function quoteFromPageText (raw: string, exact: string, contextLength = 24): TextQuote {
  const candidates = findQuoteCandidates(buildPageTextIndex(raw), exact, { limit: 1 })
  if (!candidates.length) return { exact }
  return extractQuote(raw, candidates[0].rawStart, candidates[0].rawEnd, contextLength)
}
