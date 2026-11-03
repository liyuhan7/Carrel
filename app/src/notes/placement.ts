// Placement resolution: turn a CapturePlacement into a concrete body range.
// Insertion always lands on a structural boundary — never inside a sentence,
// never blindly at the end of the document.

import type { CapturePlacement, NoteBlock } from './contracts'
import { blockSummary } from './blocks.ts'

export interface Insertion {
  /** Body after the insertion. */
  body: string
  /** Range of the inserted markdown inside `body`. */
  from: number
  to: number
  /** True when the requested block was gone and a safe fallback was used. */
  fallback: boolean
}

function findBlock (blocks: NoteBlock[], blockId: string): NoteBlock | undefined {
  return blocks.find((block) => block.blockId === blockId)
}

function isBlank (block: NoteBlock): boolean {
  return block.text.trim() === ''
}

/** Separators so the new block starts and ends on its own line without
 *  rewriting unrelated whitespace in the rest of the document. */
function separators (before: string, after: string): { lead: string; trail: string } {
  let lead = ''
  if (before.length > 0) {
    if (!before.endsWith('\n')) lead = '\n\n'
    else if (!before.endsWith('\n\n')) lead = '\n'
  }
  let trail = ''
  if (after.length === 0) trail = '\n'
  else if (!after.startsWith('\n')) trail = '\n\n'
  else if (!after.startsWith('\n\n')) trail = '\n'
  return { lead, trail }
}

export function computeInsertion (
  body: string,
  blocks: NoteBlock[],
  placement: CapturePlacement,
  contentMarkdown: string
): Insertion {
  const inserted = contentMarkdown.replace(/^\n+/, '').replace(/\s+$/, '')
  if (!inserted) throw new Error('插入内容为空')

  let insertAt = body.length
  let removeTo = insertAt
  let fallback = false

  if (placement.kind !== 'append') {
    const block = findBlock(blocks, placement.blockId)
    if (!block) {
      fallback = true
    } else if (placement.kind === 'at-empty-block' && isBlank(block)) {
      insertAt = block.from
      removeTo = block.to
    } else {
      // A non-empty block can only be appended after its full structure.
      if (placement.kind === 'at-empty-block') fallback = true
      insertAt = block.to
      removeTo = insertAt
    }
  }

  const before = body.slice(0, insertAt)
  const after = body.slice(removeTo)
  const { lead, trail } = separators(before, after)
  const nextBody = before + lead + inserted + trail + after
  const from = before.length + lead.length
  return { body: nextBody, from, to: from + inserted.length, fallback }
}

/** Human-readable placement preview used by the capture menu. */
export function placementLabel (placement: CapturePlacement, blocks: NoteBlock[]): string {
  if (placement.kind === 'append') return '插入到文末'
  const block = findBlock(blocks, placement.blockId)
  if (!block) return '插入到文末（原位置已失效）'
  if (placement.kind === 'at-empty-block' && isBlank(block)) return '插入到当前空段落'
  const summary = blockSummary(block)
  return summary ? `插入到「${summary}」之后` : '插入到当前段落后'
}

/** Placement implied by a note's last writing position. */
export function placementFromPosition (
  position: { blockId?: string } | undefined,
  blocks: NoteBlock[]
): CapturePlacement {
  if (position?.blockId) {
    const block = findBlock(blocks, position.blockId)
    if (block) {
      return isBlank(block)
        ? { kind: 'at-empty-block', blockId: block.blockId }
        : { kind: 'after-block', blockId: block.blockId }
    }
  }
  return { kind: 'append' }
}
