import { useState } from 'react'
import { useStore } from '../store'
import { formatTime } from '../lib/format'
import { recentActivity } from './CourseSelect'

function defaultTerm (): string {
  const now = new Date()
  const year = now.getFullYear()
  return now.getMonth() + 1 >= 8 ? `${year} 秋` : `${year} 春`
}

export function CoursesPage () {
  const courses = useStore((s) => s.courses)
  const files = useStore((s) => s.files)
  const sessions = useStore((s) => s.sessions)
  const notes = useStore((s) => s.notes)
  const openCourse = useStore((s) => s.openCourse)
  const createCourse = useStore((s) => s.createCourse)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const active = courses.filter((course) => !course.archivedAt)
  const archived = courses.filter((course) => course.archivedAt)
  const unfiled = files.filter((file) => !file.courseId)

  const stats = (id: string) => {
    const owned = files.filter((file) => file.courseId === id)
    const threads = sessions.filter((session) => session.courseId === id)
    const pages = notes.filter((note) => (note.courseId ?? null) === id)
    return {
      files: owned.length,
      sessions: threads.length,
      notes: pages.length,
      recent: recentActivity(owned, threads, pages)
    }
  }

  const table = (list: typeof courses) => (
    <table className="table course-table">
      <thead>
        <tr>
          <th scope="col">课程</th>
          <th scope="col">学期</th>
          <th scope="col" className="num">资料</th>
          <th scope="col" className="num">会话</th>
          <th scope="col" className="num">笔记</th>
          <th scope="col">最近</th>
        </tr>
      </thead>
      <tbody>
        {list.map((course) => {
          const row = stats(course.id)
          return (
            <tr key={course.id} onClick={() => openCourse(course.id)}>
              <td>
                <span className="course-name-cell">
                  <span className="course-dot" style={{ background: course.color }} aria-hidden="true" />
                  <span className="course-name-text">{course.name}</span>
                </span>
              </td>
              <td className="muted">{course.term || '—'}</td>
              <td className="num">{row.files}</td>
              <td className="num">{row.sessions}</td>
              <td className="num">{row.notes}</td>
              <td className="muted">{row.recent ? formatTime(row.recent) : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div className="page courses-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">COURSES</p>
          <h1>课程</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          新建课程
        </button>
      </header>

      {courses.length === 0 ? (
        <section className="empty-hero">
          <svg className="empty-mark" viewBox="0 0 120 90" fill="none" aria-hidden="true">
            <path d="M22 18h44a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6V24a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M28 32h32M28 40h32M28 48h22" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M72 30h26v48H78" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <h2>还没有课程</h2>
          <p>建一门课，把资料、会话和笔记放进去。</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            新建课程
          </button>
        </section>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h3>本学期</h3>
            </div>
            {active.length ? table(active) : <p className="muted">本学期还没有课程。</p>}
          </section>

          <section className="section">
            <div className="section-head">
              <h3>未归类</h3>
            </div>
            <button type="button" className="course-unfiled" onClick={() => openCourse(null)}>
              <span>未归类</span>
              <span className="muted">{unfiled.length} 份资料</span>
            </button>
          </section>

          {archived.length ? (
            <section className="section">
              <div className="section-head">
                <button type="button" className="link" onClick={() => setShowArchived((value) => !value)}>
                  已归档（{archived.length}）{showArchived ? ' ⌃' : ' ⌄'}
                </button>
              </div>
              {showArchived ? table(archived) : null}
            </section>
          ) : null}
        </>
      )}

      {creating ? (
        <NewCourseDialog
          onClose={() => setCreating(false)}
          onCreate={(name, term) => {
            const id = createCourse(name, term)
            openCourse(id)
          }}
        />
      ) : null}
    </div>
  )
}

function NewCourseDialog ({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (name: string, term: string) => void
}) {
  const [name, setName] = useState('')
  const [term, setTerm] = useState(defaultTerm())

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <form
        className="modal modal-sm"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          onCreate(name, term)
          onClose()
        }}
      >
        <div className="modal-head">
          <h2>新建课程</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>名称</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="如 高等数学" />
          </label>
          <label className="field">
            <span>学期</span>
            <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="如 2026 秋" />
          </label>
        </div>
        <div className="modal-foot">
          <span />
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>创建</button>
          </div>
        </div>
      </form>
    </div>
  )
}
