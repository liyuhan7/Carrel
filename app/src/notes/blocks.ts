// Markdown structure blocks: parse, reconcile and locate.
// A block is a structural unit (heading, paragraph, list, quote, code fence, table,
// rule or blank run). Ranges are UTF-16 offsets into the Markdown body.

import type { NoteBlock, NoteBlockKind, ParsedNoteBlock } from './contracts'

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const QUOTE = /^ {0,3}>/
const TABLE = /^ {0,3}\|/
const INDENTED = /^(?: {2,}|\t)/

interface Line {
  text: string
  from: number
  to: number
}

function splitLines (body: string): Line[] {
  const lines: Line[] = []
  let offset = 0
  for (;;) {
    const newline = body.indexOf('\n', offset)
    const end = newline === -1 ? body.length : newline
    lines.push({ text: body.slice(offset, end), from: offset, to: end })
    if (newline === -1) break
    offset = newline + 1
  }
  return lines
}

/** Parses the body into structural blocks; blank runs become `blank` blocks so
 *  an empty paragraph still has a stable identity for placement. */
export function parseBlocks (body: string): ParsedNoteBlock[] {
  const lines = splitLines(body)
  const blocks: ParsedNoteBlock[] = []

  const push = (kind: NoteBlockKind, start: number, end: number, extra = 0): void => {
    const from = lines[start].from
    const to = lines[end].to + extra
    blocks.push({ kind, from, to, text: body.slice(from, to) })
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index].text
    if (!line.trim()) {
      let end = index
      while (end + 1 < lines.length && !lines[end + 1].text.trim()) end++
      // Blank runs own their trailing newline so consuming them removes the empty line.
      const ownsNewline = lines[end].to < body.length && body[lines[end].to] === '\n'
      push('blank', index, end, ownsNewline ? 1 : 0)
      index = end + 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1][0]
      const close = new RegExp(`^ {0,3}${marker}{3,}[ \\t]*$`)
      let end = index + 1
      while (end < lines.length && !close.test(lines[end].text)) end++
      if (end >= lines.length) end = lines.length - 1
      push('code', index, end)
      index = end + 1
      continue
    }

    if (HR.test(line)) {
      push('hr', index, index)
      index++
      continue
    }

    if (HEADING.test(line)) {
      push('heading', index, index)
      index++
      continue
    }

    if (TABLE.test(line)) {
      let end = index
      while (end + 1 < lines.length && TABLE.test(lines[end + 1].text)) end++
      push('table', index, end)
      index = end + 1
      continue
    }

    if (QUOTE.test(line)) {
      let end = index
      while (end + 1 < lines.length && QUOTE.test(lines[end + 1].text)) end++
      push('quote', index, end)
      index = end + 1
      continue
    }

    if (LIST_ITEM.test(line)) {
      let end = index
      while (end + 1 < lines.length) {
        const next = lines[end + 1].text
        if (!next.trim()) break
        if (LIST_ITEM.test(next) || INDENTED.test(next)) {
          end++
          continue
        }
        break
      }
      push('list', index, end)
      index = end + 1
      continue
    }

    let end = index
    while (end + 1 < lines.length) {
      const next = lines[end + 1].text
      if (!next.trim()) break
      if (HEADING.test(next) || FENCE.test(next) || HR.test(next) || TABLE.test(next) || QUOTE.test(next) || LIST_ITEM.test(next)) break
      end++
    }
    push('paragraph', index, end)
    index = end + 1
  }

  return blocks
}

/** Content revision: length + FNV-1a hash. Cheap, stable across reloads. */
export function revisionOf (body: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${body.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

/** Block containing a caret offset; a caret at the block end still belongs to it. */
export function blockAtOffset (blocks: NoteBlock[], offset: number): NoteBlock | undefined {
  let found: NoteBlock | undefined
  for (const block of blocks) {
    if (block.from > offset) break
    if (offset <= block.to) found = block
  }
  return found
}

/** Text similarity used to keep a block id across an in-place edit. */
function similarity (a: string, b: string): number {
  if (a === b) return 1
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  return (prefix + suffix) / max
}

export interface ReconcileInput {
  noteId: string
  /** Blocks from the previous revision. */
  prev: NoteBlock[]
  body: string
  docRevision: string
  now: number
  nextId: () => string
  /** Blocks overlapping this range are new; they never inherit a previous id. */
  forceNewRange?: { from: number; to: number }
}

/**
 * Re-derives block ranges after a body change while keeping ids stable:
 * unchanged head/tail blocks keep their id, blocks inside the changed middle are
 * paired with the most similar previous block, and only surplus blocks are new.
 */
export function reconcileBlocks (input: ReconcileInput): NoteBlock[] {
  const parsed = parseBlocks(input.body)
  const forced = (block: ParsedNoteBlock): boolean =>
    Boolean(input.forceNewRange && block.from < input.forceNewRange.to && block.to > input.forceNewRange.from)

  const ids: Array<string | undefined> = new Array(parsed.length).fill(undefined)

  let head = 0
  while (
    head < parsed.length &&
    head < input.prev.length &&
    !forced(parsed[head]) &&
    parsed[head].text === input.prev[head].text
  ) {
    ids[head] = input.prev[head].blockId
    head++
  }

  let tailParsed = parsed.length - 1
  let tailPrev = input.prev.length - 1
  while (
    tailParsed >= head &&
    tailPrev >= head &&
    !forced(parsed[tailParsed]) &&
    parsed[tailParsed].text === input.prev[tailPrev].text
  ) {
    ids[tailParsed] = input.prev[tailPrev].blockId
    tailParsed--
    tailPrev--
  }

  const prevPool = input.prev.slice(head, tailPrev + 1)
  const used = new Set<number>()
  for (let i = head; i <= tailParsed; i++) {
    if (ids[i] || forced(parsed[i])) continue
    let best = -1
    let bestScore = 0.25
    for (let p = 0; p < prevPool.length; p++) {
      if (used.has(p)) continue
      const score = similarity(prevPool[p].text, parsed[i].text)
      if (score > bestScore) {
        best = p
        bestScore = score
      }
    }
    if (best >= 0) {
      used.add(best)
      ids[i] = prevPool[best].blockId
    }
  }

  return parsed.map((block, index) => ({
    blockId: ids[index] ?? input.nextId(),
    noteId: input.noteId,
    from: block.from,
    to: block.to,
    text: block.text,
    docRevision: input.docRevision,
    updatedAt: input.now
  }))
}

/** First line of a block, used for placement labels. */
export function blockSummary (block: NoteBlock, max = 18): string {
  const line = block.text.split('\n').find((item) => item.trim()) ?? ''
  const plain = line.replace(/^[\s>#*\-+]+/, '').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}
