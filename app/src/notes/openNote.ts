// Navigation helpers shared by the capture feedback, tabs and switcher.

import { useStore } from '../store'
import { useNoteUi } from './ui'

/** Opens a note and asks the editor to place the caret (after the inserted block). */
export function openNoteAt (noteId: string, blockId?: string): void {
  const state = useStore.getState()
  if (!state.notes.some((note) => note.id === noteId)) return
  state.selectNote(noteId)
  if (state.view !== 'workspace' && state.view !== 'notes') state.setView('notes')
  useNoteUi.getState().requestFocus(noteId, blockId ? 'block' : 'end', blockId)
}

export function newNoteAndFocusTitle (): string {
  const state = useStore.getState()
  const id = state.createNote()
  if (state.view !== 'workspace' && state.view !== 'notes') state.setView('notes')
  useNoteUi.getState().requestFocus(id, 'title')
  return id
}
