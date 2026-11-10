import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateCourseState } from '../src/courses/migrate.ts'

const workspace = {
  tabs: [],
  activeTab: null,
  pages: {},
  zoom: 1,
  activeNoteId: null,
  contextScope: 'selection',
  readerPanel: 'doc',
  attachPageImage: false,
  activeSessionId: null
}

const file = (id, name) => ({
  id,
  name,
  path: `/tmp/${name}`,
  kind: 'pdf',
  ext: 'pdf',
  size: 1,
  mtime: 1,
  hash: `h-${id}`,
  addedAt: 1,
  lastOpenedAt: 1,
  pageCount: 1,
  favorite: false
})

const message = (id, fileId, createdAt) => ({ id, role: 'user', content: id, createdAt, fileId })

test('legacy messages group into one session per document', () => {
  const out = migrateCourseState({
    files: [file('f1', 'A.pdf'), file('f2', 'B.pdf')],
    notes: [{ id: 'n1', title: 'N', body: '', refs: [], createdAt: 1, updatedAt: 1 }],
    messages: [
      message('m1', 'f1', 10),
      message('m2', 'f2', 20),
      message('m3', 'f1', 30),
      message('m4', undefined, 40)
    ],
    workspace
  })

  assert.equal(out.courses.length, 0)
  assert.equal(out.sessions.length, 3)

  const first = out.sessions.find((session) => session.scopeFileIds[0] === 'f1')
  assert.equal(first.title, '历史对话 · A.pdf')
  assert.equal(first.lastFileId, 'f1')
  assert.equal(out.messages.filter((item) => item.sessionId === first.id).length, 2)
  assert.equal(out.messages.find((item) => item.id === 'm3').sessionId, first.id)

  const orphan = out.sessions.find((session) => session.scopeFileIds.length === 0)
  assert.equal(orphan.lastFileId, null)
  assert.equal(out.messages.find((item) => item.id === 'm4').sessionId, orphan.id)

  assert.ok(out.files.every((item) => item.courseId === null))
  assert.equal(out.notes[0].courseId, null)
  assert.equal(out.workspace.activeSessionId, null)
})

test('messages without a session are attached even when courses already exist', () => {
  const out = migrateCourseState({
    files: [file('f1', 'A.pdf')],
    notes: [],
    messages: [message('m1', 'f1', 1)],
    workspace,
    courses: [],
    sessions: []
  })
  assert.equal(out.sessions.length, 1)
  assert.equal(out.messages[0].sessionId, out.sessions[0].id)
})

test('migration leaves an already migrated state alone', () => {
  const first = migrateCourseState({ files: [file('f1', 'A.pdf')], notes: [], messages: [message('m1', 'f1', 1)], workspace })
  const again = migrateCourseState({
    files: first.files,
    notes: first.notes,
    messages: first.messages,
    workspace: first.workspace,
    courses: first.courses,
    sessions: first.sessions
  })
  assert.equal(again.sessions.length, first.sessions.length)
  assert.equal(again.sessions[0].id, first.sessions[0].id)
  assert.deepEqual(again.messages.map((item) => item.sessionId), first.messages.map((item) => item.sessionId))
})
