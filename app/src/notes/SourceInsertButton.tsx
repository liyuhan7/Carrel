// "插入来源" entry for the notes side: the reader area is not always visible, so
// the note pane/page offers the same explicit source insertion there.

import { useEffect, useRef, useState } from 'react'
import { textCache, useStore } from '../store'
import { truncate } from '../lib/format'
import { useNoteUi, type CaptureSourceInput } from './ui'
import './notes.css'

export function SourceInsertButton ({ label = '插入来源' }: { label?: string }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selection = useStore((s) => s.selection)
  const files = useStore((s) => s.files)
  const annotations = useStore((s) => s.annotations)
  const workspace = useStore((s) => s.workspace)
  const openCapture = useNoteUi((s) => s.openCapture)

  const activeFile = files.find((file) => file.id === workspace.activeTab)
  const page = activeFile ? workspace.pages[activeFile.id] ?? 1 : 1
  const pageText = activeFile ? (textCache.get(activeFile.id)?.[page - 1] ?? '').trim() : ''
  const recent = annotations.filter((item) => item.fileId === activeFile?.id).slice(0, 5)
  const selectionFile = selection ? files.find((file) => file.id === selection.fileId) : undefined

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (source: CaptureSourceInput) => {
    openCapture(source)
    setOpen(false)
  }

  return (
    <div className="popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open ? (
        <div className="popover popover-left" style={{ width: 290 }} role="menu">
          <div className="note-source-group">
            <div className="note-source-label">阅读区</div>
            {selection && selectionFile ? (
              <button
                type="button"
                className="menu-item"
                onClick={() => choose({
                  fileId: selectionFile.id,
                  fileName: selectionFile.name,
                  page: selection.page,
                  text: selection.text
                })}
              >
                <span className="menu-name">当前选区 · 第 {selection.page} 页</span>
                <span className="menu-meta">{truncate(selection.text, 42)}</span>
              </button>
            ) : (
              <p className="note-source-empty">先在阅读区选中文字，或从下面的位置选择</p>
            )}
          </div>

          <div className="note-source-group">
            <div className="note-source-label">当前页</div>
            {activeFile && pageText ? (
              <button
                type="button"
                className="menu-item"
                onClick={() => choose({ fileId: activeFile.id, fileName: activeFile.name, page, text: pageText })}
              >
                <span className="menu-name">{activeFile.name} · 第 {page} 页</span>
                <span className="menu-meta">{truncate(pageText, 42)}</span>
              </button>
            ) : (
              <p className="note-source-empty">没有可用的当前页文字</p>
            )}
          </div>

          <div className="note-source-group">
            <div className="note-source-label">最近标注</div>
            {recent.length > 0 ? (
              recent.map((annotation) => (
                <button
                  key={annotation.id}
                  type="button"
                  className="menu-item"
                  onClick={() => choose({
                    fileId: annotation.fileId,
                    fileName: activeFile?.name ?? '资料',
                    page: annotation.page,
                    text: annotation.text
                  })}
                >
                  <span className="menu-name">第 {annotation.page} 页</span>
                  <span className="menu-meta">{truncate(annotation.text, 42)}</span>
                </button>
              ))
            ) : (
              <p className="note-source-empty">这份资料还没有标注</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
