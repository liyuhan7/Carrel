import { useEffect, useMemo, useState } from 'react'
import { textCache, useStore } from '../store'
import type { Rect } from '../types'
import { PdfViewer } from './PdfViewer'
import { DocViewer } from './DocViewer'
import { TypeBadge } from './TypeBadge'
import { formatBytes } from '../lib/format'

export function ReaderPane ({ collapsed, onExpand, onCollapse }: {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}) {
  const files = useStore((s) => s.files)
  const workspace = useStore((s) => s.workspace)
  const annotations = useStore((s) => s.annotations)
  const setPage = useStore((s) => s.setPage)
  const closeTab = useStore((s) => s.closeTab)
  const openFile = useStore((s) => s.openFile)
  const importDialog = useStore((s) => s.importDialog)
  const setReaderPanel = useStore((s) => s.setReaderPanel)
  const setZoom = useStore((s) => s.setZoom)
  const removeAnnotation = useStore((s) => s.removeAnnotation)
  const focusOn = useStore((s) => s.focusOn)
  const focusQuote = useStore((s) => s.focusQuote)
  const setSelection = useStore((s) => s.setSelection)
  const addAnnotation = useStore((s) => s.addAnnotation)
  const insertSelectionToNote = useStore((s) => s.insertSelectionToNote)
  const sendQuestion = useStore((s) => s.sendQuestion)
  const focusComposer = useStore((s) => s.focusComposer)
  const notify = useStore((s) => s.notify)
  const setView = useStore((s) => s.setView)

  const [popup, setPopup] = useState<{ text: string; rects: Rect[]; x: number; y: number } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchAt, setMatchAt] = useState(0)
  const [draft, setDraft] = useState('1')

  const file = files.find((item) => item.id === workspace.activeTab)
  const page = file ? workspace.pages[file.id] ?? 1 : 1
  const pageCount = file?.pageCount || 1
  const zoom = workspace.zoom
  const fileAnnotations = annotations.filter((annotation) => annotation.fileId === file?.id)
  const pageAnnotations = fileAnnotations.filter((annotation) => annotation.page === page)

  useEffect(() => {
    setDraft(String(page))
  }, [page])

  useEffect(() => {
    if (!popup) return
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.selection-pop')) setPopup(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [popup])

  const matches = useMemo(() => {
    if (!file || !query.trim()) return []
    const pages = textCache.get(file.id) || []
    const keyword = query.trim()
    const hits: number[] = []
    pages.forEach((text, index) => {
      if (text.includes(keyword)) hits.push(index + 1)
    })
    return hits
  }, [file?.id, file?.hash, query])

  if (collapsed) {
    return (
      <button type="button" className="pane-rail" onClick={onExpand} title="展开课件阅读">
        <span>课件阅读</span>
      </button>
    )
  }

  const commitPage = () => {
    if (!file) return
    const next = Number(draft)
    if (Number.isFinite(next)) setPage(file.id, next)
    else setDraft(String(page))
  }

  const goMatch = (direction: number) => {
    if (!file || matches.length === 0) return
    const next = (matchAt + direction + matches.length) % matches.length
    setMatchAt(next)
    setPage(file.id, matches[next])
  }

  return (
    <section className="pane reader-pane">
      <div className="pane-head reader-head">
        <div className="tabs" role="tablist" aria-label="打开的资料">
          {workspace.tabs.map((id) => {
            const tabFile = files.find((item) => item.id === id)
            if (!tabFile) return null
            const active = id === workspace.activeTab
            return (
              <div
                key={id}
                className={`tab${active ? ' is-active' : ''}`}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                title={tabFile.name}
                onClick={() => void openFile(id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void openFile(id)
                }}
              >
                <TypeBadge kind={tabFile.kind} ext={tabFile.ext} />
                <span className="tab-name">{tabFile.name}</span>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`关闭 ${tabFile.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(id)
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
          <button type="button" className="tab-add" title="导入资料" onClick={() => void importDialog()}>
            ＋
          </button>
        </div>
        <button type="button" className="icon-btn" title="收起课件区" onClick={onCollapse}>
          ‹
        </button>
      </div>

      {!file ? (
        <div className="doc-empty">
          <h2>打开一份资料</h2>
          <p>从资料库选择文件，或直接导入新的课件。</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
              导入资料
            </button>
            <button type="button" className="btn" onClick={() => setView('library')}>
              打开资料库
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="reader-tools">
            <div className="tool-group">
              <button type="button" className="tool" title="上一页" disabled={page <= 1} onClick={() => setPage(file.id, page - 1)}>
                ‹
              </button>
              <label className="page-input">
                <input
                  value={draft}
                  aria-label="页码"
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitPage}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitPage()
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span>/ {pageCount}</span>
              </label>
              <button type="button" className="tool" title="下一页" disabled={page >= pageCount} onClick={() => setPage(file.id, page + 1)}>
                ›
              </button>
            </div>

            <span className="tool-sep" />

            <div className="tool-group">
              <button type="button" className="tool" title="缩小" onClick={() => setZoom(zoom - 0.15)}>
                −
              </button>
              <button type="button" className="tool zoom-value" title="适应宽度" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="tool" title="放大" onClick={() => setZoom(zoom + 0.15)}>
                ＋
              </button>
            </div>

            <span className="tool-sep" />

            <div className="seg seg-small" role="group" aria-label="阅读区视图">
              <button type="button" aria-pressed={workspace.readerPanel === 'doc'} onClick={() => setReaderPanel('doc')}>
                阅读
              </button>
              <button type="button" aria-pressed={workspace.readerPanel === 'ann'} onClick={() => setReaderPanel('ann')}>
                标注 {fileAnnotations.length > 0 ? fileAnnotations.length : ''}
              </button>
            </div>

            <span className="tool-spacer" />

            <button type="button" className={`icon-btn${searchOpen ? ' is-active' : ''}`} title="在资料中查找" onClick={() => setSearchOpen(!searchOpen)}>
              ⌕
            </button>
          </div>

          {searchOpen ? (
            <div className="reader-search">
              <input
                autoFocus
                value={query}
                placeholder="在当前资料中查找"
                aria-label="查找文字"
                onChange={(event) => {
                  setQuery(event.target.value)
                  setMatchAt(0)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') goMatch(1)
                  if (event.key === 'Escape') setSearchOpen(false)
                }}
              />
              <span className="muted">
                {query ? (matches.length ? `${matchAt + 1} / ${matches.length}` : '没有匹配') : ''}
              </span>
              <button type="button" className="icon-btn" title="上一处" disabled={!matches.length} onClick={() => goMatch(-1)}>
                ↑
              </button>
              <button type="button" className="icon-btn" title="下一处" disabled={!matches.length} onClick={() => goMatch(1)}>
                ↓
              </button>
              <button
                type="button"
                className="icon-btn"
                title="关闭查找"
                onClick={() => {
                  setSearchOpen(false)
                  setQuery('')
                }}
              >
                ✕
              </button>
            </div>
          ) : null}

          <div className="reader-body">
            {workspace.readerPanel === 'ann' ? (
              <div className="anno-list">
                <p className="anno-count">{fileAnnotations.length} 条标注 · 保存在本地</p>
                {fileAnnotations.length === 0 ? (
                  <p className="muted">选中正文后点「高亮」，标注会保存在这里。</p>
                ) : (
                  fileAnnotations.map((annotation) => (
                    <div key={annotation.id} className="anno-item">
                      <button
                        type="button"
                        className="anno-jump"
                        onClick={() => {
                          setReaderPanel('doc')
                          setPage(annotation.fileId, annotation.page)
                          focusOn(annotation.fileId, annotation.page, annotation.text)
                        }}
                      >
                        <span className="anno-page">第 {annotation.page} 页</span>
                        <span className="anno-text">{annotation.text}</span>
                      </button>
                      <button type="button" className="icon-btn" title="删除标注" onClick={() => removeAnnotation(annotation.id)}>
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : file.kind === 'pdf' ? (
              <PdfViewer
                file={file}
                page={page}
                zoom={zoom}
                annotations={pageAnnotations}
                focusQuote={focusQuote && focusQuote.fileId === file.id ? focusQuote : null}
                searchTerm={searchOpen ? query.trim() : ''}
                onSelect={(payload) => {
                  setPopup(payload)
                  setSelection({ fileId: file.id, page, text: payload.text })
                }}
              />
            ) : (
              <DocViewer file={file} zoom={zoom} />
            )}
          </div>

          <div className="reader-foot">
            <span>{formatBytes(file.size)}</span>
            <span>{file.ext.toUpperCase()}</span>
            <span className="tool-spacer" />
            {file.changed ? <span className="flag is-error">文件已在外部修改</span> : null}
            <span className="muted">选中正文可直接提问</span>
          </div>

          {popup ? (
            <div
              className="selection-pop"
              role="menu"
              style={{
                left: Math.min(popup.x, window.innerWidth - 320),
                top: Math.min(popup.y + 16, window.innerHeight - 64)
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setSelection({ fileId: file.id, page, text: popup.text })
                  setPopup(null)
                  focusComposer()
                }}
              >
                向 AI 提问
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelection({ fileId: file.id, page, text: popup.text })
                  setPopup(null)
                  void sendQuestion('请解释这段内容的含义。')
                }}
              >
                AI 解释
              </button>
              <button
                type="button"
                onClick={() => {
                  addAnnotation(file.id, page, popup.rects, popup.text)
                  setPopup(null)
                }}
              >
                高亮
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelection({ fileId: file.id, page, text: popup.text })
                  insertSelectionToNote()
                  setPopup(null)
                }}
              >
                加入笔记
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(popup.text)
                  setPopup(null)
                  notify('已复制选中内容')
                }}
              >
                复制
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
