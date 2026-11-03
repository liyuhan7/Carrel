import { useMemo, useState } from 'react'
import { useStore } from '../store'
import type { FileKind } from '../types'
import { formatBytes, formatTime } from '../lib/format'
import { TypeBadge } from './TypeBadge'

const TYPES: { id: 'all' | FileKind; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pdf', label: 'PDF' },
  { id: 'md', label: 'Markdown' },
  { id: 'image', label: '图片' },
  { id: 'other', label: '其他' }
]

export function LibraryPage () {
  const files = useStore((s) => s.files)
  const importDialog = useStore((s) => s.importDialog)
  const openFromLibrary = useStore((s) => s.openFromLibrary)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const removeFile = useStore((s) => s.removeFile)
  const revealFile = useStore((s) => s.revealFile)

  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | FileKind>('all')
  const [sort, setSort] = useState<'opened' | 'name'>('opened')

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return files
      .filter((file) => (type === 'all' || file.kind === type) && (!keyword || file.name.toLowerCase().includes(keyword)))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.lastOpenedAt - a.lastOpenedAt))
  }, [files, query, type, sort])

  return (
    <div className="page library">
      <div className="page-head">
        <div>
          <h1>资料库</h1>
          <p className="page-sub">{files.length} 份资料，原文件保存在本地</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
          导入资料
        </button>
      </div>

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
        <select className="select" value={sort} onChange={(event) => setSort(event.target.value as 'opened' | 'name')} aria-label="排序方式">
          <option value="opened">最近打开</option>
          <option value="name">名称</option>
        </select>
      </div>

      {files.length === 0 ? (
        <div className="empty-block">
          <h2>资料库是空的</h2>
          <p>支持 PDF 与 Markdown。PPTX、DOCX 的版面渲染在后续版本提供。</p>
          <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
            导入资料
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-block">
          <h2>没有匹配的资料</h2>
          <p>换个关键词或筛选条件试试。</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">名称</th>
              <th scope="col">类型</th>
              <th scope="col" className="num">大小</th>
              <th scope="col">最近打开</th>
              <th scope="col" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((file) => (
              <tr key={file.id} onClick={() => void openFromLibrary(file.id)}>
                <td>
                  <button type="button" className="name-cell" onClick={() => void openFromLibrary(file.id)}>
                    <TypeBadge kind={file.kind} ext={file.ext} />
                    <span className="name">{file.name}</span>
                    {file.missing ? <span className="flag is-error">文件缺失</span> : null}
                    {file.changed ? <span className="flag">已修改</span> : null}
                  </button>
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
      )}
    </div>
  )
}
