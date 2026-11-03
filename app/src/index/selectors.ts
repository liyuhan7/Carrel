// Selector rules: which selector fits which resource, when an Anchor may be
// reused, and how well a quote matches a candidate text.
// Matching is deterministic and local; it never creates links or moves anchors.

import type {
  Anchor,
  AnchorCreateInput,
  ContentSelector,
  ResourceKind,
  TextQuote
} from '../shared/contracts/content'
import { findAll, normalize, normalizeText, originalSpan } from './text.ts'

/** A quote shorter than this cannot identify a position on its own.
 *  Matches the citation evidence rule in lib/verify.ts. */
export const MIN_QUOTE_LENGTH = 4

/** Best candidate at or above this score may be reported as relocated. */
export const RELOCATE_THRESHOLD = 0.72
/** Below this score the fragment is treated as gone. */
export const AMBIGUOUS_THRESHOLD = 0.5
/** Two candidates closer than this are not reliably distinguishable. */
export const AMBIGUITY_MARGIN = 0.08

export interface SelectorValidation {
  ok: boolean
  reason?: string
}

export function validateSelector(kind: ResourceKind, selector: ContentSelector): SelectorValidation {
  switch (selector.type) {
    case 'resource':
      return { ok: true }
    case 'document-text':
    case 'document-region':
    case 'document-flow':
      return kind === 'document'
        ? { ok: true }
        : { ok: false, reason: '文档选择器不能用于会话或笔记' }
    case 'message':
      return kind === 'conversation'
        ? { ok: true }
        : { ok: false, reason: '消息选择器只能用于会话' }
    case 'note-block':
      return kind === 'note'
        ? { ok: true }
        : { ok: false, reason: '笔记块选择器只能用于笔记' }
    default:
      return { ok: false, reason: '未知选择器' }
  }
}

export function isSelectorAllowed(kind: ResourceKind, selector: ContentSelector): boolean {
  return validateSelector(kind, selector).ok
}

/** Structural key for selector equality; numeric noise below 1e-4 is ignored. */
export function selectorKey(selector: ContentSelector): string {
  return JSON.stringify(selector, (_key, value) =>
    typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value
  )
}

export function sameSelector(a: ContentSelector, b: ContentSelector): boolean {
  return selectorKey(a) === selectorKey(b)
}

/**
 * Reuse rule: same resource, same revision and the same position.
 * `quote.exact` alone is not enough — one page can contain the same text twice.
 */
export function isReusable(anchor: Anchor, input: AnchorCreateInput): boolean {
  return (
    anchor.resourceId === input.resourceId &&
    anchor.accepted.revision === input.revision &&
    sameSelector(anchor.accepted.selector, input.selector)
  )
}

export interface QuoteMatchOptions {
  /** Page the text belongs to (document-text). */
  page?: number
  /** Page the anchor pointed at; matching there is slightly stronger. */
  preferredPage?: number
  /** Geometry only adds weight when the anchor actually stored rects. */
  hasRects?: boolean
}

export interface QuoteMatch {
  /** Span in the original (unnormalised) text. */
  start: number
  end: number
  exact: string
  score: number
}

/**
 * All occurrences of `quote.exact` in `text`, scored by quote length, context
 * and page proximity. Scores are comparable within one text, not calibrated
 * probabilities.
 */
export function matchQuote(text: string, quote: TextQuote, options: QuoteMatchOptions = {}): QuoteMatch[] {
  const normalized = normalizeText(text)
  const needle = normalize(quote.exact)
  if (needle.length < MIN_QUOTE_LENGTH) return []

  const prefix = quote.prefix ? normalize(quote.prefix) : ''
  const suffix = quote.suffix ? normalize(quote.suffix) : ''
  const lengthBonus = Math.min(0.12, needle.length / 400)
  const pageBonus =
    options.preferredPage && options.page && options.page === options.preferredPage ? 0.04 : 0
  const rectBonus = options.hasRects ? 0.02 : 0

  return findAll(normalized.text, needle).map((at) => {
    let score = 0.74 + lengthBonus + pageBonus + rectBonus
    const before = normalized.text.slice(0, at)
    const after = normalized.text.slice(at + needle.length)
    if (prefix && before.endsWith(prefix)) score += 0.05
    if (suffix && after.startsWith(suffix)) score += 0.05
    const span = originalSpan(text, normalized, at, needle.length)
    return {
      start: span.start,
      end: span.end,
      exact: text.slice(span.start, span.end).trim(),
      score: Math.min(1, score)
    }
  })
}

export function bestQuoteMatch(
  text: string,
  quote: TextQuote,
  options: QuoteMatchOptions = {}
): QuoteMatch | null {
  const matches = matchQuote(text, quote, options)
  if (!matches.length) return null
  return matches.reduce((best, item) => (item.score > best.score ? item : best))
}

/** Human-readable position for panels and search results. */
export function selectorLabel(selector: ContentSelector): string {
  switch (selector.type) {
    case 'document-text':
      return `第 ${selector.page} 页`
    case 'document-region':
      return `第 ${selector.page} 页区域`
    case 'document-flow':
      return '正文位置'
    case 'message':
      return '会话消息'
    case 'note-block':
      return '笔记内容块'
    default:
      return '整份内容'
  }
}

export function quoteOf(selector: ContentSelector): string {
  if (selector.type === 'document-text' || selector.type === 'document-flow') {
    return selector.quote.exact
  }
  if (selector.type === 'message' || selector.type === 'note-block') {
    return selector.quote?.exact ?? ''
  }
  return ''
}
