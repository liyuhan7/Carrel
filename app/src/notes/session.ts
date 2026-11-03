// Per-note editing sessions: document revision, selection, scroll and undo history.
// Sessions survive tab switches, so switching notes never re-mounts an editor or
// forgets where the user was writing.

import type { NoteBlock, WritingPosition } from './contracts'
import { blockAtOffset, reconcileBlocks, revisionOf } from './blocks.ts'

export interface SelectionRange {
  from: number
  to: number
}

export interface UndoEntry {
  body: string
  selection: SelectionRange
  /** Set when the entry came from an insert command; undo must drop its links too. */
  operationId?: string
  at: number
}

export interface NoteSessionState {
  noteId: string
  body: string
  docRevision: string
  blocks: NoteBlock[]
  selection: SelectionRange
  scrollTop: number
  focused: boolean
  writingPosition: WritingPosition
  undo: UndoEntry[]
  redo: UndoEntry[]
  lastCheckpointAt: number
}

export interface SessionHooks {
  readPosition?: (noteId: string) => WritingPosition | undefined
  persist?: (noteId: string, position: WritingPosition, blocks: NoteBlock[]) => void
  now?: () => number
  nextId?: () => string
}

const CHECKPOINT_MS = 700
const PERSIST_MS = 350
const UNDO_LIMIT = 80

function clamp (value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function randomId (): string {
  return Math.random().toString(36).slice(2, 10)
}

export function createNoteSessionManager (initial: SessionHooks = {}) {
  const sessions = new Map<string, NoteSessionState>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let hooks: Required<Pick<SessionHooks, 'now' | 'nextId'>> & SessionHooks = {
    now: () => Date.now(),
    nextId: randomId,
    ...initial
  }

  const persistNow = (session: NoteSessionState): void => {
    const timer = timers.get(session.noteId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(session.noteId)
    }
    hooks.persist?.(session.noteId, session.writingPosition, session.blocks)
  }

  const persistSoon = (session: NoteSessionState): void => {
    if (!hooks.persist) return
    if (timers.has(session.noteId)) return
    const timer = setTimeout(() => {
      timers.delete(session.noteId)
      hooks.persist?.(session.noteId, session.writingPosition, session.blocks)
    }, PERSIST_MS)
    timers.set(session.noteId, timer)
  }

  const selectionForPosition = (
    position: WritingPosition | undefined,
    blocks: NoteBlock[],
    body: string
  ): SelectionRange => {
    if (position) {
      const revision = revisionOf(body)
      if (position.docRevision === revision && position.selection) {
        const from = clamp(position.selection.from, 0, body.length)
        const to = clamp(position.selection.to, 0, body.length)
        return { from: Math.min(from, to), to: Math.max(from, to) }
      }
      const block = position.blockId ? blocks.find((item) => item.blockId === position.blockId) : undefined
      if (block) {
        const offset = block.from + clamp(position.blockOffset ?? 0, 0, block.text.length)
        return { from: offset, to: offset }
      }
    }
    const last = blocks[blocks.length - 1]
    return last ? { from: last.to, to: last.to } : { from: 0, to: 0 }
  }

  const positionOf = (session: NoteSessionState): WritingPosition => {
    const block = blockAtOffset(session.blocks, session.selection.from)
    return {
      noteId: session.noteId,
      blockId: block?.blockId,
      blockOffset: block ? session.selection.from - block.from : undefined,
      selection: { ...session.selection },
      docRevision: session.docRevision,
      scrollTop: session.scrollTop,
      updatedAt: hooks.now()
    }
  }

  const reconcile = (session: NoteSessionState, body: string): NoteBlock[] =>
    reconcileBlocks({
      noteId: session.noteId,
      prev: session.blocks,
      body,
      docRevision: revisionOf(body),
      now: hooks.now(),
      nextId: hooks.nextId
    })

  const refresh = (session: NoteSessionState): void => {
    session.docRevision = revisionOf(session.body)
    session.blocks = reconcile(session, session.body)
    session.writingPosition = positionOf(session)
  }

  const applyEntry = (session: NoteSessionState, entry: UndoEntry): void => {
    session.body = entry.body
    session.selection = {
      from: clamp(entry.selection.from, 0, entry.body.length),
      to: clamp(entry.selection.to, 0, entry.body.length)
    }
    refresh(session)
    persistSoon(session)
  }

  const manager = {
    configure (next: SessionHooks): void {
      hooks = { ...hooks, ...next }
    },

    /** Opens or refreshes the session for a note. */
    ensure (noteId: string, body: string, storedBlocks: NoteBlock[] = []): NoteSessionState {
      let session = sessions.get(noteId)
      if (!session) {
        const revision = revisionOf(body)
        const blocks = reconcileBlocks({
          noteId,
          prev: storedBlocks,
          body,
          docRevision: revision,
          now: hooks.now(),
          nextId: hooks.nextId
        })
        const position = hooks.readPosition?.(noteId)
        const selection = selectionForPosition(position, blocks, body)
        session = {
          noteId,
          body,
          docRevision: revision,
          blocks,
          selection,
          scrollTop: position?.scrollTop ?? 0,
          focused: false,
          writingPosition: {
            noteId,
            blockId: blockAtOffset(blocks, selection.from)?.blockId,
            blockOffset: 0,
            selection,
            docRevision: revision,
            scrollTop: position?.scrollTop ?? 0,
            updatedAt: hooks.now()
          },
          undo: [],
          redo: [],
          lastCheckpointAt: 0
        }
        // Normalise a stored position (older records may carry no selection) so
        // every later write and restore sees a complete position.
        session.writingPosition = positionOf(session)
        sessions.set(noteId, session)
        return session
      }
      if (session.body !== body) manager.syncBody(noteId, body)
      return session
    },

    get (noteId: string): NoteSessionState | undefined {
      return sessions.get(noteId)
    },

    /** Applies a body change from typing; checkpoints undo history. */
    syncBody (noteId: string, body: string): void {
      const session = sessions.get(noteId)
      if (!session || session.body === body) return
      const now = hooks.now()
      if (now - session.lastCheckpointAt > CHECKPOINT_MS) {
        session.undo.push({ body: session.body, selection: session.selection, at: now })
        if (session.undo.length > UNDO_LIMIT) session.undo.shift()
        session.redo = []
      }
      session.lastCheckpointAt = now
      session.body = body
      session.docRevision = revisionOf(body)
      session.blocks = reconcile(session, body)
      session.selection = {
        from: clamp(session.selection.from, 0, body.length),
        to: clamp(session.selection.to, 0, body.length)
      }
      session.writingPosition = positionOf(session)
      persistSoon(session)
    },

    /** Replaces the document after an external commit (insert / undo). */
    acceptExternalChange (
      noteId: string,
      beforeBody: string,
      afterBody: string,
      blocks: NoteBlock[] | undefined,
      position: WritingPosition | undefined,
      operationId?: string
    ): void {
      const session = manager.ensure(noteId, beforeBody)
      session.undo.push({ body: beforeBody, selection: session.selection, operationId, at: hooks.now() })
      if (session.undo.length > UNDO_LIMIT) session.undo.shift()
      session.redo = []
      session.body = afterBody
      session.docRevision = revisionOf(afterBody)
      session.blocks = blocks ?? reconcile(session, afterBody)
      session.selection = position?.selection
        ? { from: clamp(position.selection.from, 0, afterBody.length), to: clamp(position.selection.to, 0, afterBody.length) }
        : session.selection
      session.writingPosition = position ?? positionOf(session)
      persistSoon(session)
    },

    setSelection (noteId: string, from: number, to: number): void {
      const session = sessions.get(noteId)
      if (!session) return
      session.selection = { from: Math.min(from, to), to: Math.max(from, to) }
      session.writingPosition = positionOf(session)
      persistSoon(session)
    },

    setScroll (noteId: string, scrollTop: number): void {
      const session = sessions.get(noteId)
      if (!session) return
      session.scrollTop = Math.max(0, scrollTop)
      session.writingPosition = positionOf(session)
      persistSoon(session)
    },

    setFocused (noteId: string, focused: boolean): void {
      const session = sessions.get(noteId)
      if (session) session.focused = focused
    },

    /** Mirrors a document change that already committed (insert undo); no checkpoint. */
    forceBody (
      noteId: string,
      body: string,
      blocks?: NoteBlock[],
      position?: WritingPosition
    ): void {
      const session = sessions.get(noteId) ?? manager.ensure(noteId, body)
      session.body = body
      session.docRevision = revisionOf(body)
      session.blocks = blocks ?? reconcile(session, body)
      session.selection = position?.selection
        ? {
            from: clamp(position.selection.from, 0, body.length),
            to: clamp(position.selection.to, 0, body.length)
          }
        : session.selection
      session.writingPosition = position ?? positionOf(session)
      persistSoon(session)
    },

    positionOf (noteId: string): WritingPosition | undefined {
      const session = sessions.get(noteId)
      return session ? { ...session.writingPosition } : undefined
    },

    /** Selection and scroll to restore when the note becomes visible again. */
    restore (noteId: string, body: string): { selection: SelectionRange; scrollTop: number } {
      const session = manager.ensure(noteId, body)
      const selection = selectionForPosition(session.writingPosition, session.blocks, body)
      session.selection = selection
      return { selection, scrollTop: session.scrollTop }
    },

    peekUndo (noteId: string): UndoEntry | undefined {
      return sessions.get(noteId)?.undo.at(-1)
    },

    commitUndo (noteId: string): UndoEntry | undefined {
      const session = sessions.get(noteId)
      const entry = session?.undo.pop()
      if (!session || !entry) return undefined
      session.redo.push({ body: session.body, selection: session.selection, at: hooks.now() })
      applyEntry(session, entry)
      return entry
    },

    undo (noteId: string): UndoEntry | undefined {
      return manager.commitUndo(noteId)
    },

    redo (noteId: string): UndoEntry | undefined {
      const session = sessions.get(noteId)
      const entry = session?.redo.pop()
      if (!session || !entry) return undefined
      session.undo.push({ body: session.body, selection: session.selection, at: hooks.now() })
      applyEntry(session, entry)
      return entry
    },

    flush (noteId: string): void {
      const session = sessions.get(noteId)
      if (session) persistNow(session)
    },

    /** Drops undo/redo entries that refer to an insert already undone elsewhere. */
    forgetOperation (noteId: string, operationId: string): void {
      const session = sessions.get(noteId)
      if (!session) return
      session.undo = session.undo.filter((entry) => entry.operationId !== operationId)
      session.redo = session.redo.filter((entry) => entry.operationId !== operationId)
    },

    drop (noteId: string): void {
      const timer = timers.get(noteId)
      if (timer) clearTimeout(timer)
      timers.delete(noteId)
      sessions.delete(noteId)
    }
  }

  return manager
}

/** Shared session store; the data layer installs persistence hooks on creation. */
export const noteSessions = createNoteSessionManager()

export type NoteSessionManager = ReturnType<typeof createNoteSessionManager>
