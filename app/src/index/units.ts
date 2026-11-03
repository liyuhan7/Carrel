// ContentUnit extraction: pages, chat messages and note blocks.
// Units are derived index material, never the authoritative copy of the text.
// Unit ids are stable within one resource revision and carry the locator parts
// (page number, message id, block id) so a search result can be opened without
// persisting an Anchor.

import type { ContentUnit } from '../shared/contracts/content'

export interface IndexedMessage {
  id: string
  role: string
  content: string
  status?: string
}

export interface NoteBlockText {
  blockId: string
  text: string
}

/** Removes app-only inline markers before indexing. */
export function cleanUnitText(input: string): string {
  return input
    .replace(/\[\[\s*p\s*\d+\s*\]\]/gi, ' ')
    .replace(/\(csref:[^)\s]*\)/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export const PAGE_UNIT_MARK = ':p:'
export const MESSAGE_UNIT_MARK = ':m:'
export const BLOCK_UNIT_MARK = ':b:'

export function pageUnitId(resourceId: string, page: number): string {
  return `${resourceId}${PAGE_UNIT_MARK}${page}`
}

export function messageUnitId(resourceId: string, messageId: string): string {
  return `${resourceId}${MESSAGE_UNIT_MARK}${messageId}`
}

export function blockUnitId(resourceId: string, blockId: string): string {
  return `${resourceId}${BLOCK_UNIT_MARK}${blockId}`
}

function tail(unitId: string, mark: string): string | null {
  const at = unitId.indexOf(mark)
  return at < 0 ? null : unitId.slice(at + mark.length)
}

export function pageOfUnit(unitId: string): number | null {
  const raw = tail(unitId, PAGE_UNIT_MARK)
  if (raw === null) return null
  const page = Number(raw)
  return Number.isFinite(page) ? page : null
}

export function messageIdOfUnit(unitId: string): string | null {
  return tail(unitId, MESSAGE_UNIT_MARK)
}

export function blockIdOfUnit(unitId: string): string | null {
  return tail(unitId, BLOCK_UNIT_MARK)
}

export function pageUnits(resourceId: string, revision: string, pages: string[]): ContentUnit[] {
  return pages.map((text, index) => ({
    id: pageUnitId(resourceId, index + 1),
    resourceId,
    kind: 'page',
    order: index,
    revision,
    text: cleanUnitText(text)
  }))
}

export function messageUnits(
  resourceId: string,
  revision: string,
  messages: IndexedMessage[]
): ContentUnit[] {
  const usable = messages.filter(
    (message) => message.content.trim() && message.status !== 'streaming' && message.status !== 'error'
  )
  return usable.map((message, index) => ({
    id: messageUnitId(resourceId, message.id),
    resourceId,
    kind: 'message',
    order: index,
    revision,
    text: cleanUnitText(message.content)
  }))
}

export function noteBlockUnits(
  resourceId: string,
  revision: string,
  blocks: NoteBlockText[]
): ContentUnit[] {
  return blocks.map((block, index) => ({
    id: blockUnitId(resourceId, block.blockId),
    resourceId,
    kind: 'block',
    order: index,
    revision,
    text: cleanUnitText(block.text)
  }))
}

const FENCE = /^\s*(```|~~~)/

/**
 * Splits Markdown into logical blocks on blank lines, keeping fenced code
 * blocks intact. Block ids are revision-local hints; the note module's
 * NoteBlockRegistry owns the durable ids and passes them in when available.
 */
export function markdownBlocks(body: string): NoteBlockText[] {
  const lines = body.split(/\r?\n/)
  const blocks: NoteBlockText[] = []
  let buffer: string[] = []
  let fence: string | null = null

  const flush = () => {
    const text = buffer.join('\n').trim()
    buffer = []
    if (!text) return
    blocks.push({ blockId: `blk-${blocks.length}`, text })
  }

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      if (fence && fenceMatch[1] === fence) fence = null
      else if (!fence) fence = fenceMatch[1]
      buffer.push(line)
      continue
    }
    if (!fence && !line.trim()) {
      flush()
      continue
    }
    buffer.push(line)
  }
  flush()
  return blocks
}
