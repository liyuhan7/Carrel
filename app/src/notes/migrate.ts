// One-shot migration of the note module's persisted state. Idempotent: it only
// fills missing block maps and writing positions, never rewrites existing data.

import type { NoteBlock, WritingPosition } from './contracts'
import { reconcileBlocks, revisionOf } from './blocks.ts'

export interface LegacyNote {
  id: string
  body: string
  title?: string
}

export interface NoteStateSlices {
  blocks: Record<string, NoteBlock[]>
  positions: Record<string, WritingPosition>
}

export function ensureNoteState (
  notes: LegacyNote[],
  blocks: Record<string, NoteBlock[]>,
  positions: Record<string, WritingPosition>,
  deps: { now: () => number; nextId: () => string }
): NoteStateSlices {
  const nextBlocks: Record<string, NoteBlock[]> = { ...blocks }
  const nextPositions: Record<string, WritingPosition> = { ...positions }
  for (const note of notes) {
    const revision = revisionOf(note.body)
    if (!nextBlocks[note.id]) {
      nextBlocks[note.id] = reconcileBlocks({
        noteId: note.id,
        prev: [],
        body: note.body,
        docRevision: revision,
        now: deps.now(),
        nextId: deps.nextId
      })
    }
    if (!nextPositions[note.id]) {
      const last = nextBlocks[note.id].at(-1)
      nextPositions[note.id] = {
        noteId: note.id,
        blockId: last?.blockId,
        blockOffset: 0,
        docRevision: revision,
        scrollTop: 0,
        updatedAt: deps.now()
      }
    }
  }
  return { blocks: nextBlocks, positions: nextPositions }
}
