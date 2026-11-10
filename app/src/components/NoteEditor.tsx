import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useStore } from '../store'
import type { Note } from '../types'
import { renderNote } from '../lib/markdown'
import { truncate } from '../lib/format'
import { CourseSelect } from './CourseSelect'
// >>> integration:note-capture-editing
import { noteSessions } from '../notes/session'
import { sourceStatus, type SourceStatusInput } from '../notes/sourceStatus'
import { SourceInsertButton } from '../notes/SourceInsertButton'
import { useNoteUi } from '../notes/ui'
// <<< integration:note-capture-editing

export function NoteEditor ({ note, variant }: { note: Note; variant: 'pane' | 'page' }) {
  const updateNote = useStore((s) => s.updateNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const setNoteCourse = useStore((s) => s.setNoteCourse)
  const files = useStore((s) => s.files)
  const openFile = useStore((s) => s.openFile)
  const setPage = useStore((s) => s.setPage)
  const focusOn = useStore((s) => s.focusOn)
  const notify = useStore((s) => s.notify)
  const selection = useStore((s) => s.selection)
  const insertSelectionToNote = useStore((s) => s.insertSelectionToNote)
  const saveStatus = useStore((s) => s.saveStatus)
  const rewrite = useStore((s) => s.rewrite)
  const startRewrite = useStore((s) => s.startRewrite)
  const cancelRewrite = useStore((s) => s.cancelRewrite)
  const applyRewrite = useStore((s) => s.applyRewrite)
  // >>> integration:note-capture-editing
  const undoNoteEdit = useStore((s) => s.undoNoteEdit)
  const redoNoteEdit = useStore((s) => s.redoNoteEdit)
  const links = useStore((s) => s.links)
  const anchors = useStore((s) => s.anchors)
  const resources = useStore((s) => s.resources)
  const allNotes = useStore((s) => s.notes)
  const storedBlocks = useStore((s) => s.noteBlocks[note.id])
  const uiFocus = useNoteUi((s) => s.focus)
  const highlight = useNoteUi((s) => s.highlight)
  const caretRequest = useNoteUi((s) => s.caret)
  // <<< integration:note-capture-editing

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [panel, setPanel] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [instruction, setInstruction] = useState('润色，保持原意')
  const [range, setRange] = useState<{ start: number; end: number; text: string } | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // >>> integration:note-capture-editing
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const lastBodyRef = useRef(note.body)
  const [flash, setFlash] = useState('')
  // <<< integration:note-capture-editing

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

  const openRewrite = () => {
    const area = areaRef.current
    if (!area) return
    const start = area.selectionStart
    const end = area.selectionEnd
    const text = note.body.slice(start, end)
    if (!text.trim()) {
      notify('先在笔记里选中要整理的片段', 'error')
      return
    }
    if (text.includes('csref:')) {
      notify('选区包含来源锚点，请缩小范围', 'error')
      return
    }
    setRange({ start, end, text })
    setPanel(true)
  }

  const openRef = async (refId: string) => {
    const ref = note.refs.find((item) => item.id === refId)
    if (!ref) {
      notify('来源无法定位，摘录已保留', 'error')
      return
    }
    const file = files.find((item) => item.id === ref.fileId)
    if (!file) {
      notify('来源已删除，摘录仍保留在正文中', 'error')
      return
    }
    await openFile(file.id)
    setPage(file.id, ref.page)
    focusOn(file.id, ref.page, ref.quote)
  }

  // >>> integration:note-capture-editing
  const statusInput: SourceStatusInput = useMemo(
    () => ({ links, anchors, resources, notes: allNotes, files, refs: note.refs }),
    [links, anchors, resources, allNotes, files, note.refs]
  )

  const previewHtml = useMemo(
    () => renderNote(note.body || '_还没有内容_', {
      csref: (linkId: string) => sourceStatus(linkId, statusInput)
    }),
    [note.body, statusInput]
  )

  const scrollToOffset = (offset: number) => {
    const area = areaRef.current
    if (!area || note.body.length === 0) return
    // The textarea scrolls internally; .note-body never overflows.
    const total = area.scrollHeight - area.clientHeight
    if (total <= 0) return
    const ratio = Math.max(0, Math.min(1, offset / note.body.length))
    area.scrollTop = ratio * total
  }

  const trackSelection = () => {
    const area = areaRef.current
    if (!area || composingRef.current) return
    noteSessions.setSelection(note.id, area.selectionStart, area.selectionEnd)
  }

  const trackScroll = () => {
    if (areaRef.current) noteSessions.setScroll(note.id, areaRef.current.scrollTop)
  }

  // Opening or switching notes restores block, caret and scroll from the session.
  useEffect(() => {
    noteSessions.ensure(note.id, note.body, storedBlocks ?? [])
    if (composingRef.current) return
    const restored = noteSessions.restore(note.id, note.body)
    const area = areaRef.current
    if (area) {
      area.setSelectionRange(restored.selection.from, restored.selection.to)
      area.scrollTop = restored.scrollTop
    }
    lastBodyRef.current = note.body
    setFlash('')
    noteSessions.flush(note.id)
    return () => noteSessions.flush(note.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  // External writes (captures, undo) keep the session body in sync. The caret is
  // moved only through an explicit request, never from a stale stored offset.
  useEffect(() => {
    if (noteSessions.get(note.id)?.body !== note.body) noteSessions.syncBody(note.id, note.body)
    lastBodyRef.current = note.body
  }, [note.body, note.id])

  // Explicit caret request (after an insert or undo). Never steals focus.
  useEffect(() => {
    const request = caretRequest
    if (!request || request.noteId !== note.id) return
    const area = areaRef.current
    if (!area || document.activeElement !== area) return
    const offset = Math.max(0, Math.min(request.offset, note.body.length))
    area.setSelectionRange(offset, offset)
    noteSessions.setSelection(note.id, offset, offset)
    requestAnimationFrame(() => scrollToOffset(offset))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretRequest?.nonce])

  // "打开" / "继续写" focuses the title or the caret after an inserted block.
  useEffect(() => {
    if (!uiFocus || uiFocus.noteId !== note.id) return
    if (uiFocus.target === 'title') {
      titleRef.current?.focus()
      titleRef.current?.select()
      return
    }
    const area = areaRef.current
    if (!area) return
    const block = uiFocus.blockId ? (storedBlocks ?? []).find((item) => item.blockId === uiFocus.blockId) : undefined
    // Prefer the stored writing position: it already points at the blank line
    // after an inserted block instead of the end of the block text.
    const stored = useStore.getState().notePositions[note.id]
    const caret = stored?.selection
      ? Math.min(stored.selection.from, note.body.length)
      : block
        ? block.to
        : note.body.length
    setMode('edit')
    area.focus()
    area.setSelectionRange(caret, caret)
    noteSessions.setSelection(note.id, caret, caret)
    requestAnimationFrame(() => scrollToOffset(caret))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiFocus?.nonce])

  // A visible note reveals the inserted block without touching the caret:
  // selecting the new text would make the next keystroke overwrite it.
  useEffect(() => {
    if (!highlight || highlight.noteId !== note.id) return
    requestAnimationFrame(() => scrollToOffset(highlight.to))
    setFlash('已在此处插入来源')
    const timer = setTimeout(() => setFlash(''), 2400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.nonce])
  // <<< integration:note-capture-editing

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const onPreviewClick = async (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest('a[data-ref]')
    if (!link) return
    event.preventDefault()
    const linkId = link.getAttribute('data-ref') || ''
    // >>> integration:note-capture-editing
    const view = sourceStatus(linkId, statusInput)
    if (view.link) {
      try {
        await useStore.getState().navigation.navigateToLink(linkId)
      } catch (error) {
        notify((error as Error).message || '无法打开来源', 'error')
      }
      return
    }
    // <<< integration:note-capture-editing
    void openRef(linkId)
  }

  // >>> integration:note-capture-editing
  const inlineRefIds = new Set((note.body.match(/csref:([^\s)]+)/g) ?? []).map((item) => item.slice(6)))
  const chipRefs = note.refs.filter((ref) => !inlineRefIds.has(ref.id))
  // <<< integration:note-capture-editing

  return (
    <div className={`note-editor note-editor-${variant}`}>
      <div className="note-head">
        <input
          className="note-title"
          value={note.title}
          placeholder="笔记标题"
          aria-label="笔记标题"
          // >>> integration:note-capture-editing
          ref={titleRef}
          // <<< integration:note-capture-editing
          onChange={(event) => updateNote(note.id, { title: event.target.value })}
        />
        <CourseSelect
          value={note.courseId}
          onChange={(courseId) => setNoteCourse(note.id, courseId)}
          className="note-course"
        />
        <div className="note-menu" ref={menuRef}>
          <button
            type="button"
            className="icon-btn note-more"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="笔记操作"
            title="笔记操作"
            onClick={() => setMenuOpen((value) => !value)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="popover popover-right note-menu-panel" role="menu">
              <button
                type="button"
                className="menu-item is-danger"
                onClick={() => {
                  setMenuOpen(false)
                  if (confirm(`删除笔记「${note.title || '未命名笔记'}」？可在提示中撤销恢复`)) deleteNote(note.id)
                }}
              >
                删除笔记
              </button>
            </div>
          ) : null}
        </div>
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
        {flash ? <span className="note-flash" role="status">{flash}</span> : null}
        <span className="tool-spacer" />
        <div className="note-aux">
          {/* >>> integration:note-capture-editing */}
          <SourceInsertButton label="插入来源" align="right" />
          {/* <<< integration:note-capture-editing */}
          <button type="button" className="btn btn-ghost btn-small" onClick={openRewrite}>
            AI 整理
          </button>
        </div>
      </div>

      {panel || rewrite?.noteId === note.id ? (
        <div className="rewrite-panel">
          <div className="rewrite-head">
            <span>AI 整理</span>
          </div>
          <div className="rewrite-presets">
            {['润色，保持原意', '精简，去掉重复', '整理成提纲', '补充一个例子'].map((item) => (
              <button key={item} type="button" className="chip" onClick={() => setInstruction(item)}>
                {item}
              </button>
            ))}
          </div>
          <input
            className="rewrite-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="告诉 AI 怎么整理这段"
          />
          {rewrite?.noteId === note.id ? (
            <div className={`rewrite-preview${rewrite.status === 'error' ? ' is-error' : ''}`}>
              {rewrite.status === 'error' ? (rewrite.error || '整理失败') : (rewrite.text || '生成中…')}
            </div>
          ) : null}
          <div className="form-row">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={rewrite?.status === 'streaming'}
              onClick={() => {
                if (!range) return
                void startRewrite({ noteId: note.id, start: range.start, end: range.end, text: range.text, instruction })
              }}
            >
              {rewrite?.status === 'streaming' ? '生成中…' : '开始整理'}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={rewrite?.status !== 'done' || rewrite.noteId !== note.id}
              onClick={() => {
                applyRewrite()
                setPanel(false)
              }}
            >
              应用到原文
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                cancelRewrite()
                setPanel(false)
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className="note-body" ref={bodyRef} onScroll={trackScroll}>
        {mode === 'edit' ? (
          <textarea
            ref={areaRef}
            className="note-text"
            value={note.body}
            placeholder="记录阅读中的概念、疑问和自己的理解…"
            spellCheck={false}
            // >>> integration:note-capture-editing
            onChange={(event) => {
              const value = event.target.value
              noteSessions.syncBody(note.id, value)
              updateNote(note.id, { body: value })
            }}
            onSelect={trackSelection}
            onKeyUp={trackSelection}
            onMouseUp={trackSelection}
            onScroll={trackScroll}
            onFocus={() => noteSessions.setFocused(note.id, true)}
            onBlur={() => {
              noteSessions.setFocused(note.id, false)
              trackSelection()
              noteSessions.flush(note.id)
            }}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => {
              composingRef.current = false
              trackSelection()
            }}
            onKeyDown={(event) => {
              if (composingRef.current) return
              const mod = event.metaKey || event.ctrlKey
              if (!mod) return
              const key = event.key.toLowerCase()
              if (key === 'z' && !event.shiftKey) {
                event.preventDefault()
                void undoNoteEdit(note.id)
              } else if ((key === 'z' && event.shiftKey) || key === 'y') {
                event.preventDefault()
                redoNoteEdit(note.id)
              }
            }}
            // <<< integration:note-capture-editing
          />
        ) : (
          <div
            ref={previewRef}
            className="note-preview"
            onClick={onPreviewClick}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>

      {/* >>> integration:note-capture-editing */}
      {chipRefs.length > 0 ? (
        <div className="note-refs">
          <span className="note-refs-label">来源</span>
          {chipRefs.map((ref) => {
            const view = sourceStatus(ref.id, statusInput)
            return (
              <button
                key={ref.id}
                type="button"
                className={`ref-chip is-${view.status}`}
                onClick={() => void openRef(ref.id)}
                title={view.title}
              >
                {ref.label}
                <span className="ref-chip-quote">{truncate(ref.quote, 24)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {/* <<< integration:note-capture-editing */}

      <div className="note-foot">
        {selection ? (
          <button type="button" className="link" onClick={insertSelectionToNote}>
            插入当前选中内容
          </button>
        ) : null}
        {saveStatus !== 'saved' ? (
          <span className="note-save">{saveStatus === 'saving' ? '保存中…' : '保存失败'}</span>
        ) : null}
      </div>
    </div>
  )
}
