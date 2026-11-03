import { useRef, useState, type MouseEvent } from 'react'
import { useStore } from '../store'
import type { Note } from '../types'
import { renderNote } from '../lib/markdown'
import { formatTime, truncate } from '../lib/format'

export function NoteEditor ({ note, variant }: { note: Note; variant: 'pane' | 'page' }) {
  const updateNote = useStore((s) => s.updateNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const files = useStore((s) => s.files)
  const openFile = useStore((s) => s.openFile)
  const setPage = useStore((s) => s.setPage)
  const focusOn = useStore((s) => s.focusOn)
  const notify = useStore((s) => s.notify)
  const selection = useStore((s) => s.selection)
  const insertSelectionToNote = useStore((s) => s.insertSelectionToNote)
  const saveStatus = useStore((s) => s.saveStatus)

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const wrap = (before: string, after = '') => {
    const area = areaRef.current
    if (!area) return
    setMode('edit')
    const start = area.selectionStart
    const end = area.selectionEnd
    const body = note.body
    const selected = body.slice(start, end)
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`
    updateNote(note.id, { body: next })
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  const openRef = async (refId: string) => {
    const ref = note.refs.find((item) => item.id === refId)
    if (!ref) return
    const file = files.find((item) => item.id === ref.fileId)
    if (!file) {
      notify('来源资料已不在资料库中', 'error')
      return
    }
    await openFile(file.id)
    setPage(file.id, ref.page)
    focusOn(file.id, ref.page, ref.quote)
  }

  const onPreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest('a[data-ref]')
    if (!link) return
    event.preventDefault()
    void openRef(link.getAttribute('data-ref') || '')
  }

  return (
    <div className={`note-editor note-editor-${variant}`}>
      <div className="note-head">
        <input
          className="note-title"
          value={note.title}
          placeholder="笔记标题"
          aria-label="笔记标题"
          onChange={(event) => updateNote(note.id, { title: event.target.value })}
        />
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => {
            if (confirm(`删除笔记「${note.title || '未命名笔记'}」？`)) deleteNote(note.id)
          }}
        >
          删除
        </button>
      </div>

      <div className="note-toolbar">
        <div className="seg" role="group" aria-label="编辑模式">
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
            编辑
          </button>
          <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>
            预览
          </button>
        </div>
        {mode === 'edit' ? (
          <div className="note-tools" aria-label="格式">
            <button type="button" title="小标题" onClick={() => wrap('\n## ')}>
              H
            </button>
            <button type="button" title="加粗" onClick={() => wrap('**', '**')}>
              B
            </button>
            <button type="button" title="列表" onClick={() => wrap('\n- ')}>
              ⋯
            </button>
            <button type="button" title="引用" onClick={() => wrap('\n> ')}>
              ❝
            </button>
          </div>
        ) : null}
        <div className="note-meta">
          {note.body.length} 字 · {note.refs.length} 个来源
        </div>
      </div>

      <div className="note-body">
        {mode === 'edit' ? (
          <textarea
            ref={areaRef}
            className="note-text"
            value={note.body}
            placeholder="记录阅读中的概念、疑问和自己的理解…"
            spellCheck={false}
            onChange={(event) => updateNote(note.id, { body: event.target.value })}
          />
        ) : (
          <div
            ref={previewRef}
            className="note-preview"
            onClick={onPreviewClick}
            dangerouslySetInnerHTML={{ __html: renderNote(note.body || '_还没有内容_') }}
          />
        )}
      </div>

      {note.refs.length > 0 ? (
        <div className="note-refs">
          <span className="note-refs-label">来源</span>
          {note.refs.map((ref) => (
            <button key={ref.id} type="button" className="ref-chip" onClick={() => void openRef(ref.id)} title={ref.quote}>
              {ref.label}
              <span className="ref-chip-quote">{truncate(ref.quote, 24)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="note-foot">
        {selection ? (
          <button type="button" className="link" onClick={insertSelectionToNote}>
            插入当前选中内容
          </button>
        ) : (
          <span>最近编辑 {formatTime(note.updatedAt)}</span>
        )}
        <span className="note-save">{saveStatus === 'saved' ? '已保存' : saveStatus === 'saving' ? '保存中…' : '保存失败'}</span>
      </div>
    </div>
  )
}
