import { useMemo, useState } from 'react'
import { useStore } from '../store'
import type { FileKind, FileRec, Note } from '../types'
import { formatBytes, formatTime } from '../lib/format'
import { TypeBadge } from './TypeBadge'
import { FilePreview } from './FilePreview'
import { CourseSelect, courseNameOf } from './CourseSelect'

const TYPES: { id: 'all' | FileKind; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pdf', label: 'PDF' },
  { id: 'md', label: 'Markdown' },
  { id: 'image', label: '图片' },
  { id: 'other', label: '其他' }
]

export function LibraryPage () {
  const files = useStore((s) => s.files)
  const notes = useStore((s) => s.notes)
  const courses = useStore((s) => s.courses)
  const resources = useStore((s) => s.resources)
  const anchors = useStore((s) => s.anchors)
  const links = useStore((s) => s.links)
  const workspace = useStore((s) => s.workspace)
  const importDialog = useStore((s) => s.importDialog)
  const openFromLibrary = useStore((s) => s.openFromLibrary)
  const selectNote = useStore((s) => s.selectNote)
  const setView = useStore((s) => s.setView)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const removeFile = useStore((s) => s.removeFile)
  const revealFile = useStore((s) => s.revealFile)
  const setFileCourse = useStore((s) => s.setFileCourse)

  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | FileKind>('all')
  const [course, setCourse] = useState('all')
  const [sort, setSort] = useState<'opened' | 'name'>('opened')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return files
      .filter((file) =>
        (type === 'all' || file.kind === type) &&
        (course === 'all' || (course === 'unfiled' ? !file.courseId : file.courseId === course)) &&
        (!keyword || file.name.toLowerCase().includes(keyword))
      )
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.lastOpenedAt - a.lastOpenedAt))
  }, [files, query, type, course, sort])

  const selected = filtered.find((file) => file.id === selectedId) ?? filtered[0] ?? null

  const relatedNotes = useMemo(() => {
    if (!selected) return [] as Note[]
    const documentResource = Object.values(resources).find(
      (resource) => resource.kind === 'document' && resource.sourceId === selected.id
    )
    return notes
      .filter((note) => {
        if (note.refs.some((ref) => ref.fileId === selected.id)) return true
        if (!documentResource) return false
        const noteResource = Object.values(resources).find(
          (resource) => resource.kind === 'note' && resource.sourceId === note.id
        )
        if (!noteResource) return false
        return Object.values(links).some((link) => {
          const from = anchors[link.fromAnchorId]
          const to = anchors[link.toAnchorId]
          return (
            (from?.resourceId === noteResource.id && to?.resourceId === documentResource.id) ||
            (to?.resourceId === noteResource.id && from?.resourceId === documentResource.id)
          )
        })
      })
      .slice(0, 4)
  }, [selected, notes, resources, anchors, links])

  const openDetail = (file: FileRec) => {
    setSelectedId(file.id)
  }

  return (
    <div className="page library">
      <header className="page-head">
        <div>
          <p className="eyebrow">YOUR LIBRARY</p>
          <h1>资料</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
          导入资料
        </button>
      </header>

      {files.length === 0 ? (
        <section className="empty-hero library-empty">
          <svg className="empty-mark" viewBox="0 0 120 90" fill="none" aria-hidden="true">
            <path d="M24 20h40a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M30 34h28M30 42h28M30 50h18" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M76 34h20v40H80" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <h2>从一份资料开始</h2>
          <p>把想读的文章或课件放进来，慢慢建立自己的知识书房。</p>
          <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
            导入第一份资料
          </button>
        </section>
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名" aria-label="搜索文件名" />
            </label>
            <div className="chips" role="group" aria-label="按类型筛选">
              {TYPES.map((item) => (
                <button key={item.id} type="button" aria-pressed={type === item.id} onClick={() => setType(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="chips" role="group" aria-label="按课程筛选">
              <button type="button" aria-pressed={course === 'all'} onClick={() => setCourse('all')}>
                全部课程
              </button>
              <button type="button" aria-pressed={course === 'unfiled'} onClick={() => setCourse('unfiled')}>
                未归类
              </button>
              {courses.map((item) => (
                <button key={item.id} type="button" title={item.name} aria-pressed={course === item.id} onClick={() => setCourse(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>
            <select className="select" value={sort} onChange={(event) => setSort(event.target.value as 'opened' | 'name')} aria-label="排序方式">
              <option value="opened">最近打开</option>
              <option value="name">名称</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-block">
              <h2>没有匹配的资料</h2>
            </div>
          ) : (
            <div className="library-layout">
              <div className="library-list">
                <table className="table library-table">
                  <thead>
                    <tr>
                      <th scope="col">名称</th>
                      <th scope="col">课程</th>
                      <th scope="col">类型</th>
                      <th scope="col" className="num">大小</th>
                      <th scope="col">最近打开</th>
                      <th scope="col" aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((file) => (
                      <tr
                        key={file.id}
                        className={selected?.id === file.id ? 'is-selected' : undefined}
                        onClick={() => openDetail(file)}
                      >
                        <td>
                          <button type="button" className="name-cell" onClick={() => void openFromLibrary(file.id)}>
                            <TypeBadge kind={file.kind} ext={file.ext} />
                            <span className="name">{file.name}</span>
                            {file.missing ? <span className="flag is-error">文件缺失</span> : null}
                            {file.changed ? <span className="flag">已修改</span> : null}
                          </button>
                        </td>
                        <td>
                          <CourseSelect
                            value={file.courseId}
                            onChange={(courseId) => setFileCourse(file.id, courseId)}
                          />
                        </td>
                        <td className="muted">{file.ext.toUpperCase()}</td>
                        <td className="num muted">{formatBytes(file.size)}</td>
                        <td className="muted">{formatTime(file.lastOpenedAt)}</td>
                        <td className="row-actions" onClick={(event) => event.stopPropagation()}>
                          <button type="button" title={file.favorite ? '取消收藏' : '收藏'} aria-pressed={file.favorite} onClick={() => toggleFavorite(file.id)}>
                            {file.favorite ? '★' : '☆'}
                          </button>
                          <button type="button" title="在文件夹中显示" onClick={() => revealFile(file.id)}>
                            ⌖
                          </button>
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
              </div>

              {selected ? (
                <aside className="library-detail">
                  <FilePreview file={selected} width={360} fill className="detail-thumb" />
                  <h2 className="detail-title" title={selected.name}>
                    {selected.name.split(/(?<=[_.\-/])/).map((part, index) => (
                      <span key={index}>{part}<wbr /></span>
                    ))}
                  </h2>
                  <dl className="detail-meta">
                    <div><dt>类型</dt><dd>{selected.ext.toUpperCase()}</dd></div>
                    <div><dt>课程</dt><dd>{courseNameOf(selected.courseId, courses)}</dd></div>
                    <div><dt>大小</dt><dd>{formatBytes(selected.size)}</dd></div>
                    {selected.kind === 'pdf' ? (
                      <div><dt>页数</dt><dd>{selected.pageCount || 1}</dd></div>
                    ) : null}
                    <div><dt>最近打开</dt><dd>{formatTime(selected.lastOpenedAt)}</dd></div>
                  </dl>
                  {selected.kind === 'pdf' ? (
                    <div className="detail-progress">
                      <div className="progress" role="progressbar" aria-valuenow={Math.round((((workspace.pages[selected.id] ?? 1) / (selected.pageCount || 1)) * 100))} aria-valuemin={0} aria-valuemax={100}>
                        <span style={{ width: `${Math.round((((workspace.pages[selected.id] ?? 1) / (selected.pageCount || 1)) * 100))}%` }} />
                      </div>
                      <span className="detail-progress-label">
                        第 {workspace.pages[selected.id] ?? 1} 页 / 共 {selected.pageCount || 1} 页
                      </span>
                    </div>
                  ) : null}
                  <button type="button" className="btn btn-primary btn-block" onClick={() => void openFromLibrary(selected.id)}>
                    {selected.kind === 'pdf' ? '打开阅读' : selected.kind === 'md' ? '打开文档' : selected.kind === 'image' ? '查看图片' : '打开文件'}
                  </button>

                  <section className="detail-notes">
                    <div className="detail-notes-head">
                      <h3>相关笔记</h3>
                      <button type="button" className="link" onClick={() => setView('notes')}>
                        全部笔记
                      </button>
                    </div>
                    {relatedNotes.length === 0 ? (
                      <p className="detail-empty">还没有笔记引用这份资料</p>
                    ) : (
                      <ul>
                        {relatedNotes.map((note) => (
                          <li key={note.id}>
                            <button
                              type="button"
                              className="detail-note"
                              onClick={() => {
                                selectNote(note.id)
                                setView('notes')
                              }}
                            >
                              <span className="detail-note-title">{note.title || '未命名笔记'}</span>
                              <span className="detail-note-meta">{formatTime(note.updatedAt)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </aside>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}
