// AnchorResolver: read-only position resolution for every selector kind.
// A resolve run never rewrites `origin` or `accepted`; a relocated candidate is
// only a proposal until the user confirms it.

import type {
  Anchor,
  AnchorResolver,
  ContentSelector,
  ContentUnit,
  ResolveResult,
  Resource,
  TextQuote
} from '../shared/contracts/content'
import {
  AMBIGUITY_MARGIN,
  AMBIGUOUS_THRESHOLD,
  RELOCATE_THRESHOLD,
  isSelectorAllowed,
  matchQuote,
  type QuoteMatch
} from './selectors.ts'
import { blockIdOfUnit, messageIdOfUnit } from './units.ts'

export interface ResolverDeps {
  getResource(resourceId: string): Resource | undefined
  /** Extracted page texts for a document source; null when unavailable. */
  getPages(sourceId: string): string[] | null | undefined
  /** Units of the current content index for a resource. */
  getUnits(resourceId: string): ContentUnit[]
}

interface Candidate {
  page: number
  match: QuoteMatch
  distance: number
  score: number
}

const MAX_CANDIDATES = 3

function withQuote(quote: TextQuote, exact: string): TextQuote {
  return { exact: exact || quote.exact, prefix: quote.prefix, suffix: quote.suffix }
}

function documentTextCandidates(
  pages: string[],
  selector: Extract<ContentSelector, { type: 'document-text' }>
): Candidate[] {
  const candidates: Candidate[] = []
  for (let page = 1; page <= pages.length; page += 1) {
    const text = pages[page - 1] ?? ''
    if (!text) continue
    const distance = Math.abs(page - selector.page)
    const matches = matchQuote(text, selector.quote, {
      page,
      preferredPage: selector.page,
      hasRects: Boolean(selector.rects?.length)
    })
    for (const match of matches) {
      candidates.push({
        page,
        match,
        distance,
        // Nearby pages are preferred but a far, strong match can still win.
        score: match.score - Math.min(0.12, distance * 0.03)
      })
    }
  }
  return candidates.sort((a, b) => b.score - a.score)
}

function relocatedSelector(
  candidate: Candidate,
  selector: Extract<ContentSelector, { type: 'document-text' }>
): ContentSelector {
  return {
    ...selector,
    page: candidate.page,
    quote: withQuote(selector.quote, candidate.match.exact),
    // Rectangles belong to one page; never carry them to another page.
    rects: candidate.page === selector.page ? selector.rects : undefined
  }
}

function candidateSelectors(
  candidates: Candidate[],
  selector: Extract<ContentSelector, { type: 'document-text' }>
): ContentSelector[] {
  return candidates.slice(0, MAX_CANDIDATES).map((candidate) => relocatedSelector(candidate, selector))
}

function resolveDocumentText(
  anchor: Anchor,
  resource: Resource,
  deps: ResolverDeps,
  selector: Extract<ContentSelector, { type: 'document-text' }>
): ResolveResult {
  const pages = deps.getPages(resource.sourceId)
  if (!pages || !pages.length) return { anchorId: anchor.id, status: 'unlocatable' }

  const sameRevision = anchor.accepted.revision === resource.revision
  const candidates = documentTextCandidates(pages, selector)

  if (!candidates.length) {
    // A page without extracted text (scanned PDF) gives no basis to re-locate.
    if (!(pages[selector.page - 1] ?? '').trim()) {
      return { anchorId: anchor.id, status: 'unlocatable' }
    }
    return { anchorId: anchor.id, status: 'orphaned' }
  }

  const best = candidates[0]
  if (sameRevision && candidates.some((candidate) => candidate.page === selector.page)) {
    return { anchorId: anchor.id, status: 'ok', selector }
  }
  if (best.score < AMBIGUOUS_THRESHOLD) {
    return { anchorId: anchor.id, status: 'orphaned' }
  }

  const second = candidates[1]
  const tied = Boolean(second && best.score - second.score < AMBIGUITY_MARGIN)
  if (tied || best.score < RELOCATE_THRESHOLD) {
    return {
      anchorId: anchor.id,
      status: 'ambiguous',
      candidates: candidateSelectors(candidates, selector)
    }
  }

  return {
    anchorId: anchor.id,
    status: 'relocated',
    selector: relocatedSelector(best, selector),
    candidates: [relocatedSelector(best, selector)]
  }
}

function resolveRegion(
  anchor: Anchor,
  resource: Resource,
  deps: ResolverDeps,
  selector: Extract<ContentSelector, { type: 'document-region' }>
): ResolveResult {
  const pages = deps.getPages(resource.sourceId)
  if (!pages || !pages.length) return { anchorId: anchor.id, status: 'unlocatable' }
  // Geometry alone cannot be restored after the page content changed.
  if (anchor.accepted.revision !== resource.revision) {
    return { anchorId: anchor.id, status: 'unlocatable' }
  }
  return { anchorId: anchor.id, status: 'ok', selector }
}

function resolveFlow(
  anchor: Anchor,
  resource: Resource,
  deps: ResolverDeps,
  selector: Extract<ContentSelector, { type: 'document-flow' }>
): ResolveResult {
  const pages = deps.getPages(resource.sourceId)
  if (!pages || !pages.length) return { anchorId: anchor.id, status: 'unlocatable' }
  const joined = pages.join('\n')
  const matches = matchQuote(joined, selector.quote)
  if (!matches.length) return { anchorId: anchor.id, status: 'orphaned' }

  const sameRevision = anchor.accepted.revision === resource.revision
  const best = matches.reduce((a, b) => (b.score > a.score ? b : a))
  if (sameRevision) return { anchorId: anchor.id, status: 'ok', selector }

  const second = matches.find((match) => match !== best)
  if (best.score < AMBIGUOUS_THRESHOLD) return { anchorId: anchor.id, status: 'orphaned' }
  if ((second && best.score - second.score < AMBIGUITY_MARGIN) || best.score < RELOCATE_THRESHOLD) {
    return {
      anchorId: anchor.id,
      status: 'ambiguous',
      candidates: matches.slice(0, MAX_CANDIDATES).map((match) => ({
        ...selector,
        quote: withQuote(selector.quote, match.exact),
        start: match.start,
        end: match.end
      }))
    }
  }
  return {
    anchorId: anchor.id,
    status: 'relocated',
    selector: {
      ...selector,
      quote: withQuote(selector.quote, best.exact),
      start: best.start,
      end: best.end
    }
  }
}

function resolveMessage(
  anchor: Anchor,
  deps: ResolverDeps,
  selector: Extract<ContentSelector, { type: 'message' }>
): ResolveResult {
  const units = deps.getUnits(anchor.resourceId)
  // No indexed conversation yet: the message may exist, so do not claim loss.
  if (!units.length) return { anchorId: anchor.id, status: 'unlocatable' }
  const unit = units.find(
    (item) => item.kind === 'message' && messageIdOfUnit(item.id) === selector.messageId
  )
  // A deleted or edited-away message is not silently re-pointed to another one.
  if (!unit) return { anchorId: anchor.id, status: 'orphaned' }
  if (!selector.quote?.exact) return { anchorId: anchor.id, status: 'ok', selector }
  if (matchQuote(unit.text, selector.quote).length) {
    return { anchorId: anchor.id, status: 'ok', selector }
  }
  return { anchorId: anchor.id, status: 'orphaned' }
}

function resolveNoteBlock(
  anchor: Anchor,
  deps: ResolverDeps,
  selector: Extract<ContentSelector, { type: 'note-block' }>
): ResolveResult {
  const units = deps.getUnits(anchor.resourceId).filter((item) => item.kind === 'block')
  // No indexed note yet: report that we cannot tell instead of "lost".
  if (!units.length) return { anchorId: anchor.id, status: 'unlocatable' }
  const target = units.find((item) => blockIdOfUnit(item.id) === selector.blockId)
  const quote = selector.quote

  if (target && (!quote?.exact || matchQuote(target.text, quote).length)) {
    return { anchorId: anchor.id, status: 'ok', selector }
  }
  if (!quote?.exact) {
    return {
      anchorId: anchor.id,
      status: units.length ? 'orphaned' : 'unlocatable'
    }
  }

  const candidates: { unit: ContentUnit; match: QuoteMatch }[] = []
  for (const unit of units) {
    for (const match of matchQuote(unit.text, quote)) candidates.push({ unit, match })
  }
  candidates.sort((a, b) => b.match.score - a.match.score)
  if (!candidates.length) return { anchorId: anchor.id, status: 'orphaned' }

  const best = candidates[0]
  if (best.match.score < AMBIGUOUS_THRESHOLD) return { anchorId: anchor.id, status: 'orphaned' }
  const second = candidates[1]
  const tied = Boolean(second && best.match.score - second.match.score < AMBIGUITY_MARGIN)
  if (tied || best.match.score < RELOCATE_THRESHOLD) {
    return {
      anchorId: anchor.id,
      status: 'ambiguous',
      candidates: candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
        type: 'note-block',
        blockId: blockIdOfUnit(candidate.unit.id) ?? selector.blockId,
        quote: withQuote(quote, candidate.match.exact)
      }))
    }
  }
  return {
    anchorId: anchor.id,
    status: 'relocated',
    selector: {
      type: 'note-block',
      blockId: blockIdOfUnit(best.unit.id) ?? selector.blockId,
      quote: withQuote(quote, best.match.exact)
    }
  }
}

export function createAnchorResolver(deps: ResolverDeps): AnchorResolver {
  return {
    supports(resource: Resource, selector: ContentSelector): boolean {
      return Boolean(resource) && isSelectorAllowed(resource.kind, selector)
    },

    async resolve(anchor: Anchor): Promise<ResolveResult> {
      const resource = deps.getResource(anchor.resourceId)
      if (!resource || resource.availability !== 'available') {
        return { anchorId: anchor.id, status: 'missing' }
      }

      const selector = anchor.accepted.selector
      if (!isSelectorAllowed(resource.kind, selector)) {
        return { anchorId: anchor.id, status: 'unlocatable' }
      }

      switch (selector.type) {
        case 'resource':
          return { anchorId: anchor.id, status: 'ok', selector }
        case 'document-text':
          return resolveDocumentText(anchor, resource, deps, selector)
        case 'document-region':
          return resolveRegion(anchor, resource, deps, selector)
        case 'document-flow':
          return resolveFlow(anchor, resource, deps, selector)
        case 'message':
          return resolveMessage(anchor, deps, selector)
        case 'note-block':
          return resolveNoteBlock(anchor, deps, selector)
        default:
          return { anchorId: anchor.id, status: 'unlocatable' }
      }
    }
  }
}
