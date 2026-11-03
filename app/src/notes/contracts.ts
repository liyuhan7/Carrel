// Note module contracts: writing position, capture draft and the single insert command.
// Owned by the note module. Shapes follow docs/Carrel_笔记记录与编辑交互设计.md §4, §7.2, §11.1.

import type { ContentSelector, NoteSourceRelation, StateTransaction } from '../shared/contracts/content'

/** Where the caret last lived in a note; the insert target for external captures. */
export interface WritingPosition {
  noteId: string
  /** Stable block id of the current or most recently active block. */
  blockId?: string
  /** Offset inside that block; a restoration hint only. */
  blockOffset?: number
  selection?: { from: number; to: number }
  docRevision: string
  scrollTop: number
  updatedAt: number
}

export type CapturePlacement =
  | { kind: 'after-block'; blockId: string }
  | { kind: 'at-empty-block'; blockId: string }
  | { kind: 'append' }

export interface NoteSourceCandidate {
  resourceId: string
  selector: ContentSelector
  relation: NoteSourceRelation
  selected: boolean
}

export interface CaptureDraft {
  id: string
  targetNoteId: string
  content: string
  placement: CapturePlacement
  /** Candidates are not links; links are created only on confirmed save. */
  sourceCandidates: NoteSourceCandidate[]
  createdAt: number
}

export interface InsertCaptureCommand {
  targetNoteId: string
  placement: CapturePlacement
  contentMarkdown: string
  sourceCandidates?: NoteSourceCandidate[]
  /** Idempotency key: retries with the same id must not insert twice. */
  operationId?: string
}

export interface InsertCaptureResult {
  noteId: string
  insertedBlockId: string
  insertedRange: { from: number; to: number }
  createdLinkIds: string[]
  /** True when the requested placement was unavailable and a fallback was used. */
  placementFallback: boolean
}

/** Stable block identity persisted next to the Markdown body by NoteBlockRegistry. */
export interface NoteBlock {
  blockId: string
  noteId: string
  from: number
  to: number
  text: string
  docRevision: string
  updatedAt: number
}

export interface NoteBlockRegistry {
  blocksFor(noteId: string): NoteBlock[]
  blockAt(noteId: string, blockId: string): NoteBlock | undefined
  /** Re-derive ranges after a body change; block ids survive edits when possible. */
  reconcile(noteId: string, body: string, docRevision: string): NoteBlock[]
}

export interface NoteInsertService {
  insertCapture(command: InsertCaptureCommand, tx: StateTransaction): Promise<InsertCaptureResult>
}

/** In-memory editor session per note: document, selection, scroll and undo history. */
export interface NoteSession {
  noteId: string
  docRevision: string
  dirty: boolean
  writingPosition: WritingPosition
}

// ─── note module additions (see handoff: 契约增补) ─────────────────────────

/** Structural kind of a parsed Markdown block. `blank` is an empty paragraph run. */
export type NoteBlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'hr'
  | 'blank'

/** Parser output before block ids are assigned by NoteBlockRegistry.reconcile. */
export interface ParsedNoteBlock {
  kind: NoteBlockKind
  from: number
  to: number
  text: string
}
