// Transient note UI state: capture menu, draft panel, focus/highlight requests and
// the delete undo banner. Not persisted; durable state lives in the store.

import { create } from 'zustand'
import type { CaptureDraft } from './contracts'

export interface CaptureSourceInput {
  fileId: string
  fileName: string
  page: number
  text: string
}

export interface NoteFocusRequest {
  noteId: string
  target: 'title' | 'end' | 'block'
  blockId?: string
  nonce: number
}

export interface NoteCaretRequest {
  noteId: string
  offset: number
  nonce: number
}

export interface NoteHighlight {
  noteId: string
  blockId: string
  from: number
  to: number
  nonce: number
}

export interface CaptureFeedback {
  noteId: string
  blockId: string
  operationId: string
  label: string
  at: number
}

export interface UndoBanner {
  noteId: string
  title: string
  at: number
}

interface NoteUi {
  focus: NoteFocusRequest | null
  highlight: NoteHighlight | null
  /** Move the caret only when the note editor already has focus. */
  caret: NoteCaretRequest | null
  feedback: CaptureFeedback | null
  undoBanner: UndoBanner | null
  switcherOpen: boolean
  captureSource: CaptureSourceInput | null
  draft: CaptureDraft | null
  /** Last explicit capture target; invalidated when that note disappears. */
  lastTargetNoteId: string | null

  requestFocus: (noteId: string, target: NoteFocusRequest['target'], blockId?: string) => void
  requestCaret: (noteId: string, offset: number) => void
  flashInsert: (noteId: string, blockId: string, from: number, to: number) => void
  setFeedback: (feedback: CaptureFeedback | null) => void
  showUndo: (banner: UndoBanner | null) => void
  openSwitcher: () => void
  closeSwitcher: () => void
  openCapture: (source: CaptureSourceInput) => void
  closeCapture: () => void
  openDraft: (draft: CaptureDraft) => void
  updateDraft: (patch: Partial<CaptureDraft>) => void
  closeDraft: () => void
  setTargetNote: (noteId: string) => void
}

let nonce = 0

export const useNoteUi = create<NoteUi>((set) => ({
  focus: null,
  highlight: null,
  caret: null,
  feedback: null,
  undoBanner: null,
  switcherOpen: false,
  captureSource: null,
  draft: null,
  lastTargetNoteId: null,

  requestFocus: (noteId, target, blockId) => set({ focus: { noteId, target, blockId, nonce: ++nonce } }),
    requestCaret: (noteId, offset) => set({ caret: { noteId, offset, nonce: ++nonce } }),
  flashInsert: (noteId, blockId, from, to) => set({ highlight: { noteId, blockId, from, to, nonce: ++nonce } }),
  setFeedback: (feedback) => set({ feedback }),
  showUndo: (undoBanner) => set({ undoBanner }),
  openSwitcher: () => set({ switcherOpen: true }),
  closeSwitcher: () => set({ switcherOpen: false }),
  openCapture: (captureSource) => set({ captureSource }),
  closeCapture: () => set({ captureSource: null }),
  openDraft: (draft) => set({ draft }),
  updateDraft: (patch) => set((state) => ({ draft: state.draft ? { ...state.draft, ...patch } : null })),
  closeDraft: () => set({ draft: null }),
  setTargetNote: (lastTargetNoteId) => set({ lastTargetNoteId })
}))
