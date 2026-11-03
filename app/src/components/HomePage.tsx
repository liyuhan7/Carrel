import { useStore } from '../store'
import { formatTime, greeting, truncate } from '../lib/format'
import { TypeBadge } from './TypeBadge'

export function HomePage () {
  const files = useStore((s) => s.files)
  const notes = useStore((s) => s.notes)
  const workspace = useStore((s) => s.workspace)
  const openFile = useStore((s) => s.openFile)
  const importDialog = useStore((s) => s.importDialog)
  const setView = useStore((s) => s.setView)
  const selectNote = useStore((s) => s.selectNote)
  const createNote = useStore((s) => s.createNote)

  const active = files.find((f) => f.id === workspace.activeTab)
  const recentFiles = [...files].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 5)
  const recentNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4)
  const page = active ? workspace.pages[active.id] ?? 1 : 1
  const progress = active ? Math.min(100, Math.round((page / (active.pageCount || 1)) * 100)) : 0

  return (
    <div className="page home">
      <div className="page-head">
        <div>
          <h1>{greeting()}</h1>
          <p className="page-sub">
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · {new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
          导入资料
        </button>
      </div>

      <div className="home-grid">
        <div className="home-col">
          {active ? (
            <section className="resume">
              <div className="resume-spine" aria-hidden="true" />
              <div className="resume-main">
                <div className="resume-top">
                  <div>
                    <p className="resume-label">上次读到 · {formatTime(active.lastOpenedAt)}</p>
                    <h2>{active.name}</h2>
                    <p className="resume-meta">
                      第 {page} 页，共 {active.pageCount || 1} 页 · {progress}%
                    </p>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={() => void openFile(active.id)}>
                    继续阅读
                  </button>
                </div>
                <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            </section>
          ) : (
            <section className="empty-hero">
              <h2>还没有导入资料</h2>
              <p>导入 PDF 或 Markdown，选中正文就能提问，回答和摘录都会带上出处。</p>
              <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
                导入第一份资料
              </button>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h3>最近打开</h3>
              <button type="button" className="link" onClick={() => setView('library')}>
                全部资料
              </button>
            </div>
            {recentFiles.length === 0 ? (
              <p className="muted">导入的资料会出现在这里。</p>
            ) : (
              <ul className="file-list">
                {recentFiles.map((file) => (
                  <li key={file.id}>
                    <button type="button" className="file-row" onClick={() => void openFile(file.id)}>
                      <TypeBadge kind={file.kind} ext={file.ext} />
                      <span className="file-name">{file.name}</span>
                      <span className="file-meta">{formatTime(file.lastOpenedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="home-col">
          <section className="section">
            <div className="section-head">
              <h3>最近笔记</h3>
              <button type="button" className="link" onClick={() => setView('notes')}>
                全部笔记
              </button>
            </div>
            {recentNotes.length === 0 ? (
              <p className="muted">还没有笔记。</p>
            ) : (
              <ul className="note-list-compact">
                {recentNotes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      className="note-row"
                      onClick={() => {
                        selectNote(note.id)
                        setView('notes')
                      }}
                    >
                      <span className="note-row-title">{note.title || '未命名笔记'}</span>
                      <span className="note-row-excerpt">{truncate(note.body.replace(/[#>*`\n-]/g, ' ').trim(), 48) || '空笔记'}</span>
                      <span className="note-row-meta">
                        {formatTime(note.updatedAt)}
                        {note.refs.length > 0 ? ` · ${note.refs.length} 个来源` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="link add-note" onClick={() => { createNote(); setView('notes') }}>
              ＋ 新建笔记
            </button>
          </section>

          <section className="section quiet">
            <h3>学习空间的键盘操作</h3>
            <dl className="keys">
              <div><dt>导入资料</dt><dd>Ctrl O</dd></div>
              <div><dt>聚焦提问</dt><dd>Ctrl K</dd></div>
              <div><dt>立即保存</dt><dd>Ctrl S</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}
