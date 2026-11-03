import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { NoteEditor } from './NoteEditor'
import { formatTime, truncate } from '../lib/format'

const plain = (body: string) => body.replace(/[#>*`\n\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim()

export function NotesPage () {
  const notes = useStore((s) => s.notes)
  const activeNoteId = useStore((s) => s.workspace.activeNoteId)
  const selectNote = useStore((s) => s.selectNote)
  const createNote = useStore((s) => s.createNote)
  const [query, setQuery] = useState('')

  const active = notes.find((note) => note.id === activeNoteId) ?? notes[0]
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return [...notes]
      .filter((note) => !keyword || note.title.toLowerCase().includes(keyword) || note.body.toLowerCase().includes(keyword))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, query])

  return (
    <div className="page notes-page">
      <div className="page-head">
        <div>
          <h1>笔记</h1>
          <p className="page-sub">{notes.length} 份笔记 · 自动保存</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => createNote()}>
          新建笔记
        </button>
      </div>

      <div className="notes-layout">
        <aside className="notes-list">
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
            <NoteEditor key={active.id} note={active} variant="page" />
          ) : (
            <div className="empty-block">
              <h2>还没有笔记</h2>
              <p>笔记独立于资料，可以从任何课件里引用内容。</p>
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
