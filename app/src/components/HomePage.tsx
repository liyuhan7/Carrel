import { useStore } from '../store'
import { formatTime, greeting } from '../lib/format'
import { TypeBadge } from './TypeBadge'
import { PdfThumb } from './PdfThumb'

const plain = (body: string) => body.replace(/[#>*`\n\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim()

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
  const recentNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3)
  const page = active ? workspace.pages[active.id] ?? 1 : 1
  const progress = active ? Math.min(100, Math.round((page / (active.pageCount || 1)) * 100)) : 0

  return (
    <div className="page home">
      <header className="page-head home-head">
        <div>
          <p className="eyebrow">YOUR STUDY</p>
          <h1>{greeting()}</h1>
          <p className="page-sub">
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · {new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
          导入资料
        </button>
      </header>

      {active ? (
        <section className="continue-card">
          <PdfThumb file={active} width={196} className="continue-thumb" />
          <div className="continue-main">
            <p className="eyebrow">CONTINUE READING</p>
            <h2>{active.name}</h2>
            <p className="continue-meta">
              第 {page} 页 / 共 {active.pageCount || 1} 页 · 上次读到 {formatTime(active.lastOpenedAt)}
            </p>
            <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="continue-actions">
              <button type="button" className="btn btn-primary" onClick={() => void openFile(active.id)}>
                继续阅读
              </button>
              <span className="continue-progress">{progress}%</span>
            </div>
          </div>
        </section>
      ) : (
        <section className="empty-hero home-empty">
          <svg className="empty-mark" viewBox="0 0 120 90" fill="none" aria-hidden="true">
            <path d="M22 18h44a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6V24a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M28 32h32M28 40h32M28 48h22" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M72 30h26v48H78" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <h2>从一份资料开始</h2>
          <p>把想读的文章或课件放进来，慢慢建立自己的知识书房。</p>
          <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
            导入第一份资料
          </button>
        </section>
      )}

      <div className="home-grid">
        <section className="section">
          <div className="section-head">
            <h3>最近资料</h3>
            <button type="button" className="link" onClick={() => setView('library')}>
              全部资料
            </button>
          </div>
          {recentFiles.length === 0 ? null : (
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

        <aside className="section">
          <div className="section-head">
            <h3>最近笔记</h3>
            <button type="button" className="link" onClick={() => setView('notes')}>
              全部笔记
            </button>
          </div>
          {recentNotes.length === 0 ? (
            <p className="muted">还没有笔记。</p>
          ) : (
            <ul className="note-previews">
              {recentNotes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="note-preview"
                    onClick={() => {
                      selectNote(note.id)
                      setView('notes')
                    }}
                  >
                    <span className="note-preview-title">{note.title || '未命名笔记'}</span>
                    <span className="note-preview-body">
                      {plain(note.body) || '尚未开始记录'}
                    </span>
                    <span className="note-preview-meta">
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
        </aside>
      </div>
    </div>
  )
}
