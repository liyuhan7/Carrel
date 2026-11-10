import { useState } from 'react'
import { useStore } from '../store'
import type { Session } from '../types'
import { formatTime } from '../lib/format'
import { Popover } from './Popover'
import { CourseSelect } from './CourseSelect'
import { TypeBadge } from './TypeBadge'

type Tab = 'files' | 'sessions' | 'notes'

const TABS: { id: Tab; label: string }[] = [
  { id: 'files', label: '资料' },
  { id: 'sessions', label: '会话' },
  { id: 'notes', label: '笔记' }
]

export function CoursePage () {
  const courseId = useStore((s) => s.courseId)
  const courses = useStore((s) => s.courses)
  const files = useStore((s) => s.files)
  const sessions = useStore((s) => s.sessions)
  const notes = useStore((s) => s.notes)
  const messages = useStore((s) => s.messages)
  const openFile = useStore((s) => s.openFile)
  const newSession = useStore((s) => s.newSession)
  const selectSession = useStore((s) => s.selectSession)
  const renameSession = useStore((s) => s.renameSession)
  const toggleSessionPin = useStore((s) => s.toggleSessionPin)
  const archiveSession = useStore((s) => s.archiveSession)
  const restoreSession = useStore((s) => s.restoreSession)
  const deleteSession = useStore((s) => s.deleteSession)
  const importDialog = useStore((s) => s.importDialog)
  const removeFile = useStore((s) => s.removeFile)
  const setFileCourse = useStore((s) => s.setFileCourse)
  const setSessionCourse = useStore((s) => s.setSessionCourse)
  const setNoteCourse = useStore((s) => s.setNoteCourse)
  const createNote = useStore((s) => s.createNote)
  const selectNote = useStore((s) => s.selectNote)
  const setView = useStore((s) => s.setView)
  const renameCourse = useStore((s) => s.renameCourse)
  const archiveCourse = useStore((s) => s.archiveCourse)
  const restoreCourse = useStore((s) => s.restoreCourse)
  const deleteCourse = useStore((s) => s.deleteCourse)

  const [tab, setTab] = useState<Tab>('files')
  const [renamingCourse, setRenamingCourse] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [editingSession, setEditingSession] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const course = courses.find((item) => item.id === courseId) ?? null
  const courseFiles = files
    .filter((file) => (file.courseId ?? null) === courseId)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const courseSessions = sessions.filter((session) => (session.courseId ?? null) === courseId)
  const activeSessions = courseSessions
    .filter((session) => !session.archivedAt)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
  const archivedSessions = courseSessions
    .filter((session) => session.archivedAt)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  const courseNotes = notes
    .filter((note) => (note.courseId ?? null) === courseId)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const today = new Date().setHours(0, 0, 0, 0)
  const groups = [
    { label: '置顶', items: activeSessions.filter((session) => session.pinned) },
    { label: '今天', items: activeSessions.filter((session) => !session.pinned && session.updatedAt >= today) },
    { label: '更早', items: activeSessions.filter((session) => !session.pinned && session.updatedAt < today) }
  ].filter((group) => group.items.length > 0)

  const startSession = () => {
    const recent = courseFiles[0]
    if (!recent) return
    if (useStore.getState().streaming) {
      useStore.getState().notify('正在生成回答，结束后再新建会话', 'error')
      return
    }
    void openFile(recent.id).then(() => newSession())
  }

  const scopeLabel = (session: Session): string => {
    if (!session.scopeFileIds.length) return '无资料'
    const file = files.find((item) => item.id === session.scopeFileIds[0])
    if (!file) return '资料已删除'
    return file.name
  }

  const commitRename = (session: Session, value: string) => {
    setEditingSession(null)
    if (value.trim() && value.trim() !== session.title) renameSession(session.id, value)
  }

  const confirmDeleteCourse = () => {
    if (!course) return
    const message = course.archivedAt
      ? `删除课程「${course.name}」？其中的资料、会话和笔记将移到未归类。`
      : `删除课程「${course.name}」？`
    if (confirm(message)) deleteCourse(course.id)
  }

  return (
    <div className="page course-page">
      <button type="button" className="link course-back" onClick={() => setView('courses')}>← 课程</button>

      <header className="page-head">
        <div>
          {renamingCourse && course ? (
            <input
              className="course-name-input"
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => {
                renameCourse(course.id, { name: draftName })
                setRenamingCourse(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  renameCourse(course.id, { name: draftName })
                  setRenamingCourse(false)
                } else if (event.key === 'Escape') {
                  setRenamingCourse(false)
                }
              }}
            />
          ) : (
            <h1>{course?.name ?? '未归类'}</h1>
          )}
          <p className="page-sub">
            {course?.term ? `${course.term} · ` : ''}
            {courseFiles.length} 份资料 · {courseSessions.length} 场会话 · {courseNotes.length} 篇笔记
          </p>
        </div>
        {course ? (
          <div className="course-actions">
            <button
              type="button"
              className="btn"
              onClick={() => (course.archivedAt ? restoreCourse(course.id) : archiveCourse(course.id))}
            >
              {course.archivedAt ? '恢复' : '归档'}
            </button>
            {course.archivedAt ? (
              <button type="button" className="btn" onClick={confirmDeleteCourse}>
                删除
              </button>
            ) : null}
            <Popover
              align="right"
              width={180}
              dismissOnClick
              trigger={() => <span className="btn btn-ghost">⋯</span>}
            >
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setDraftName(course.name)
                  setRenamingCourse(true)
                }}
              >
                <span className="menu-name">重命名</span>
              </button>
              {course.archivedAt || (!courseFiles.length && !courseSessions.length && !courseNotes.length) ? (
                <button
                  type="button"
                  className="menu-item is-danger"
                  onClick={confirmDeleteCourse}
                >
                  <span className="menu-name">删除课程</span>
                </button>
              ) : null}
            </Popover>
          </div>
        ) : null}
      </header>

      <div className="page-tabs" role="tablist" aria-label="课程内容">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`page-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span className="page-tab-count">
              {item.id === 'files' ? courseFiles.length : item.id === 'sessions' ? courseSessions.length : courseNotes.length}
            </span>
          </button>
        ))}
      </div>

      {tab === 'files' ? (
        <section className="section">
          <div className="section-head">
            <h3>资料</h3>
            <button type="button" className="btn btn-small" onClick={() => void importDialog(courseId)}>
              导入资料
            </button>
          </div>
          {courseFiles.length === 0 ? (
            <div className="empty-block">
              <h2>这门课还没有资料</h2>
              <button type="button" className="btn btn-primary" onClick={() => void importDialog(courseId)}>
                导入资料
              </button>
            </div>
          ) : (
            <table className="table course-table">
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  <th scope="col">类型</th>
                  <th scope="col" className="num">页数</th>
                  <th scope="col">课程</th>
                  <th scope="col">最近打开</th>
                  <th scope="col" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {courseFiles.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <button type="button" className="name-cell" onClick={() => void openFile(file.id)}>
                        <TypeBadge kind={file.kind} ext={file.ext} />
                        <span className="name">{file.name}</span>
                        {file.missing ? <span className="flag is-error">文件缺失</span> : null}
                      </button>
                    </td>
                    <td className="muted">{file.ext.toUpperCase()}</td>
                    <td className="num muted">{file.kind === 'pdf' ? file.pageCount || 1 : '—'}</td>
                    <td>
                      <CourseSelect
                        value={file.courseId}
                        onChange={(id) => setFileCourse(file.id, id)}
                      />
                    </td>
                    <td className="muted">{formatTime(file.lastOpenedAt)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        title="从资料库移除"
                        onClick={() => {
                          if (confirm(`从资料库移除「${file.name}」？原始文件不会被删除。`)) removeFile(file.id)
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {tab === 'sessions' ? (
        <section className="section">
          <div className="section-head">
            <h3>会话</h3>
            <button type="button" className="btn btn-small" disabled={!courseFiles.length} onClick={startSession}>
              新建会话
            </button>
          </div>
          {activeSessions.length === 0 && archivedSessions.length === 0 ? (
            <div className="empty-block">
              <h2>还没有会话</h2>
              {courseFiles.length ? (
                <button type="button" className="btn btn-primary" onClick={startSession}>
                  新建会话
                </button>
              ) : null}
            </div>
          ) : (
            <div className="session-list">
              {groups.map((group) => (
                <div key={group.label} className="session-group">
                  <p className="session-group-head">{group.label}</p>
                  {group.items.map((session) => (
                    <div key={session.id} className="session-row">
                      {editingSession === session.id ? (
                        <div className="session-main">
                          <input
                            className="session-title-input"
                            autoFocus
                            defaultValue={session.title}
                            onBlur={(event) => commitRename(session, event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitRename(session, event.currentTarget.value)
                              if (event.key === 'Escape') setEditingSession(null)
                            }}
                          />
                          <span className="session-meta">
                            {scopeLabel(session)} · {formatTime(session.updatedAt)}
                          </span>
                        </div>
                      ) : (
                        <button type="button" className="session-main" onClick={() => void selectSession(session.id)}>
                          <span className="session-title">{session.title}</span>
                          <span className="session-meta">
                            {scopeLabel(session)}
                            {' · '}
                            {messages.filter((message) => message.sessionId === session.id).length} 条
                            {' · '}
                            {formatTime(session.updatedAt)}
                          </span>
                        </button>
                      )}
                      <CourseSelect
                        value={session.courseId}
                        onChange={(id) => setSessionCourse(session.id, id)}
                        className="session-course"
                        label="移到课程"
                      />
                      <div className="session-actions">
                        <button
                          type="button"
                          title={session.pinned ? '取消置顶' : '置顶'}
                          aria-pressed={Boolean(session.pinned)}
                          onClick={() => toggleSessionPin(session.id)}
                        >
                          {session.pinned ? '★' : '☆'}
                        </button>
                        <button type="button" title="重命名" onClick={() => setEditingSession(session.id)}>✎</button>
                        <button type="button" title="归档" onClick={() => archiveSession(session.id)}>▣</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {archivedSessions.length ? (
                <div className="session-group">
                  <button type="button" className="link session-archived-toggle" onClick={() => setShowArchived((value) => !value)}>
                    已归档（{archivedSessions.length}）{showArchived ? ' ⌃' : ' ⌄'}
                  </button>
                  {showArchived
                    ? archivedSessions.map((session) => (
                        <div key={session.id} className="session-row">
                          <button type="button" className="session-main" onClick={() => void selectSession(session.id)}>
                            <span className="session-title">{session.title}</span>
                            <span className="session-meta">
                              {scopeLabel(session)} · {messages.filter((message) => message.sessionId === session.id).length} 条
                            </span>
                          </button>
                          <div className="session-actions">
                            <button type="button" title="恢复" onClick={() => restoreSession(session.id)}>↺</button>
                            <button
                              type="button"
                              title="删除会话"
                              onClick={() => {
                                if (confirm(`删除会话「${session.title}」及其消息？`)) deleteSession(session.id)
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))
                    : null}
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'notes' ? (
        <section className="section">
          <div className="section-head">
            <h3>笔记</h3>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                createNote('未命名笔记', courseId)
                setView('notes')
              }}
            >
              新建笔记
            </button>
          </div>
          {courseNotes.length === 0 ? (
            <div className="empty-block">
              <h2>还没有笔记</h2>
            </div>
          ) : (
            <table className="table course-table notes-table">
              <thead>
                <tr>
                  <th scope="col">标题</th>
                  <th scope="col">课程</th>
                  <th scope="col">来源</th>
                  <th scope="col">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {courseNotes.map((note) => (
                  <tr
                    key={note.id}
                    onClick={() => {
                      selectNote(note.id)
                      setView('notes')
                    }}
                  >
                    <td>{note.title || '未命名笔记'}</td>
                    <td>
                      <CourseSelect
                        value={note.courseId}
                        onChange={(id) => setNoteCourse(note.id, id)}
                      />
                    </td>
                    <td className="muted">
                      {note.origin?.sessionId ? '来自会话' : note.origin?.fileId ? '来自资料' : '独立撰写'}
                    </td>
                    <td className="muted">{formatTime(note.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  )
}
