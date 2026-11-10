import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { NoteEditor } from './NoteEditor'
import { formatTime, truncate } from '../lib/format'
import { courseNameOf } from './CourseSelect'
// >>> integration:note-capture-editing
import { NoteModuleHost, NoteTabs } from '../notes/NoteModuleHost'
// <<< integration:note-capture-editing

const plain = (body: string) => body.replace(/[#>*`\n\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim()

export function NotesPage () {
  const notes = useStore((s) => s.notes)
  const courses = useStore((s) => s.courses)
  const activeNoteId = useStore((s) => s.workspace.activeNoteId)
  const selectNote = useStore((s) => s.selectNote)
  const createNote = useStore((s) => s.createNote)
  const [query, setQuery] = useState('')
  const [course, setCourse] = useState('all')

  const active = notes.find((note) => note.id === activeNoteId) ?? notes[0]
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return [...notes]
      .filter((note) =>
        (course === 'all' || (course === 'independent' ? !note.courseId : note.courseId === course)) &&
        (!keyword || note.title.toLowerCase().includes(keyword) || note.body.toLowerCase().includes(keyword))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, query, course])

  return (
    <div className="page notes-page">
      {/* >>> integration:note-capture-editing */}
      <NoteModuleHost />
      {/* <<< integration:note-capture-editing */}
      <header className="page-head">
        <div>
          <p className="eyebrow">NOTES</p>
          <h1>笔记</h1>
        </div>
        {/* >>> integration:note-capture-editing */}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => createNote()}>
            新建笔记
          </button>
        </div>
        {/* <<< integration:note-capture-editing */}
      </header>

      {/* >>> integration:note-capture-editing */}
      <NoteTabs />
      {/* <<< integration:note-capture-editing */}

      <div className="notes-layout">
        <aside className="notes-list">
          <select
            className="select notes-filter"
            value={course}
            aria-label="按课程筛选"
            onChange={(event) => setCourse(event.target.value)}
          >
            <option value="all">全部笔记</option>
            <option value="independent">独立笔记</option>
            {courses.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记" aria-label="搜索笔记" />
          </label>
          <ul>
            {filtered.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className={`notes-list-item${note.id === active?.id ? ' is-active' : ''}`}
                  onClick={() => selectNote(note.id)}
                >
                  <span className="item-title">{note.title || '未命名笔记'}</span>
                  <span className="item-excerpt">{truncate(plain(note.body), 56) || '空笔记'}</span>
                  <span className="item-meta">
                    {note.courseId ? `${courseNameOf(note.courseId, courses)} · ` : ''}
                    {formatTime(note.updatedAt)}
                    {note.refs.length > 0 ? ` · ${note.refs.length} 个来源` : ''}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 ? <li className="muted notes-empty">没有匹配的笔记</li> : null}
          </ul>
        </aside>

        <section className="notes-detail">
          {active ? (
            // >>> integration:note-capture-editing
            // No key: the note session restores caret and scroll without re-mounting.
            <NoteEditor note={active} variant="page" />
            // <<< integration:note-capture-editing
          ) : (
            <div className="empty-block">
              <h2>还没有笔记</h2>
              <button type="button" className="btn btn-primary" onClick={() => createNote()}>
                新建笔记
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
