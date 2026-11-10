// One-shot migration from the flat library/chat state to courses and sessions.
// Legacy messages are grouped by the document they were asked about, so no
// message is dropped and every message ends up in exactly one session.
// Idempotent: a message whose session still exists is left untouched.

import type { ChatMessage, Course, FileRec, Note, Session, WorkspaceState } from '../types'
import { uid } from '../lib/format.ts'

export interface LegacyCourseState {
  files: FileRec[]
  notes: Note[]
  messages: ChatMessage[]
  workspace: WorkspaceState
  courses?: Course[]
  sessions?: Session[]
}

export interface CourseState {
  courses: Course[]
  sessions: Session[]
  files: FileRec[]
  notes: Note[]
  messages: ChatMessage[]
  workspace: WorkspaceState
}

export function migrateCourseState (input: LegacyCourseState): CourseState {
  const files = input.files.map((file) => ({ ...file, courseId: file.courseId ?? null }))
  const notes = input.notes.map((note) => (note.courseId === undefined ? { ...note, courseId: null } : note))

  const sessions = [...(input.sessions ?? [])]
  const known = new Set(sessions.map((session) => session.id))
  const groups = new Map<string, ChatMessage[]>()
  for (const message of input.messages) {
    // A session that still exists owns the message; anything else is legacy.
    if (message.sessionId && known.has(message.sessionId)) continue
    const key = message.fileId ?? ''
    const list = groups.get(key)
    if (list) list.push(message)
    else groups.set(key, [message])
  }

  const assigned = new Map<string, string>()
  for (const [fileId, list] of groups) {
    const id = uid()
    const file = files.find((item) => item.id === fileId)
    const createdAt = list[0]?.createdAt ?? Date.now()
    sessions.push({
      id,
      courseId: file?.courseId ?? null,
      scopeFileIds: fileId ? [fileId] : [],
      lastFileId: fileId || null,
      title: file ? `历史对话 · ${file.name}` : '历史对话',
      createdAt,
      updatedAt: list[list.length - 1]?.createdAt ?? createdAt
    })
    for (const message of list) assigned.set(message.id, id)
  }

  const messages = input.messages.map((message) => {
    const sessionId = assigned.get(message.id)
    return sessionId ? { ...message, sessionId } : message
  })

  return {
    courses: input.courses ?? [],
    sessions,
    files,
    notes,
    messages,
    workspace: { ...input.workspace, activeSessionId: input.workspace.activeSessionId ?? null }
  }
}
