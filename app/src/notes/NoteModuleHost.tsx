// Note module host: tabs, quick switcher, keyboard shortcuts and capture feedback.
// Mounted from the note pane and the notes page; owns no persisted state.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { truncate } from '../lib/format'
import { CaptureMenu } from './CaptureMenu'
import { newNoteAndFocusTitle, openNoteAt } from './openNote'
import { useNoteUi } from './ui'
import './notes.css'

const plain = (body: string) => body.replace(/[#>*`\n\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim()

export function NoteModuleHost () {
  const captureSource = useNoteUi((s) => s.captureSource)
  const closeCapture = useNoteUi((s) => s.closeCapture)
  const switcherOpen = useNoteUi((s) => s.switcherOpen)

  return (
    <>
      <NoteShortcuts />
      {switcherOpen ? <NoteSwitcher /> : null}
      <NoteCaptureFeedback />
      <NoteUndoBanner />
      {captureSource ? (
        <CaptureMenu
          source={captureSource}
          x={window.innerWidth - 340}
          y={96}
          onClose={closeCapture}
        />
      ) : null}
    </>
  )
}

function NoteShortcuts () {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        event.stopPropagation()
        useNoteUi.getState().openSwitcher()
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        newNoteAndFocusTitle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return null
}

export function NoteTabs ({ trailing }: { trailing?: ReactNode }) {
  const notes = useStore((s) => s.notes)
  const activeNoteId = useStore((s) => s.workspace.activeNoteId)
  const tabIds = useStore((s) => s.workspace.noteTabs ?? [])
  const selectNote = useStore((s) => s.selectNote)
  const closeNoteTab = useStore((s) => s.closeNoteTab)

  const tabs = tabIds
    .map((id) => notes.find((note) => note.id === id))
    .filter((note): note is NonNullable<typeof note> => Boolean(note))

  return (
    <div className="note-tabs-bar">
      <div className="note-tabs" role="tablist" aria-label="最近使用的笔记">
        {tabs.map((note) => {
          const active = note.id === activeNoteId
          return (
            <div
              key={note.id}
              className={`note-tab${active ? ' is-active' : ''}`}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              title={note.title || '未命名笔记'}
              onClick={() => selectNote(note.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') selectNote(note.id)
              }}
            >
              <span className="note-tab-title">{note.title || '未命名笔记'}</span>
              <button
                type="button"
                className="note-tab-close"
                aria-label={`从页签移除 ${note.title || '未命名笔记'}`}
                onClick={(event) => {
                  event.stopPropagation()
                  closeNoteTab(note.id)
                }}
              >
                ✕
              </button>
            </div>
          )
        })}
        <button type="button" className="note-tab-add" title="新建笔记（Ctrl+N）" onClick={() => newNoteAndFocusTitle()}>
          ＋
        </button>
      </div>
      {trailing ? <div className="note-tabs-actions">{trailing}</div> : null}
    </div>
  )
}

function NoteSwitcher () {
  const notes = useStore((s) => s.notes)
  const closeSwitcher = useNoteUi((s) => s.closeSwitcher)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return [...notes]
      .filter((note) => !keyword || note.title.toLowerCase().includes(keyword) || note.body.toLowerCase().includes(keyword))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
  }, [notes, query])

  const choose = (id: string) => {
    openNoteAt(id)
    closeSwitcher()
  }

  return (
    <div className="note-switcher-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) closeSwitcher() }}>
      <div className="note-switcher" role="dialog" aria-label="切换笔记">
        <input
          autoFocus
          value={query}
          placeholder="搜索笔记标题或正文"
          aria-label="搜索笔记"
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeSwitcher()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((value) => Math.min(value + 1, filtered.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((value) => Math.max(value - 1, 0))
            } else if (event.key === 'Enter' && filtered[cursor]) {
              event.preventDefault()
              choose(filtered[cursor].id)
            }
          }}
        />
        <div className="note-switcher-list">
          {filtered.map((note, index) => (
            <button
              key={note.id}
              type="button"
              className={`note-switcher-item${index === cursor ? ' is-active' : ''}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => choose(note.id)}
            >
              <span className="note-switcher-title">{note.title || '未命名笔记'}</span>
              <span className="note-switcher-excerpt">{truncate(plain(note.body), 46) || '空笔记'}</span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="note-switcher-empty">没有匹配的笔记</p> : null}
        </div>
      </div>
    </div>
  )
}

function NoteCaptureFeedback () {
  const feedback = useNoteUi((s) => s.feedback)
  const setFeedback = useNoteUi((s) => s.setFeedback)
  const undoInsert = useStore((s) => s.undoInsert)

  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 9000)
    return () => clearTimeout(timer)
  }, [feedback, setFeedback])

  if (!feedback) return null

  return (
    <div className="capture-feedback-bar" role="status" aria-live="polite">
      <span>{feedback.label}</span>
      <button type="button" className="link" onClick={() => { openNoteAt(feedback.noteId, feedback.blockId); setFeedback(null) }}>
        打开
      </button>
      <button
        type="button"
        className="link"
        onClick={() => {
          void (async () => {
            const ok = await undoInsert(feedback.operationId)
            setFeedback(null)
            if (!ok) useStore.getState().notify('撤销失败：插入记录已失效', 'error')
          })()
        }}
      >
        撤销
      </button>
      <button type="button" className="link" aria-label="关闭提示" onClick={() => setFeedback(null)}>
        ✕
      </button>
    </div>
  )
}

function NoteUndoBanner () {
  const banner = useNoteUi((s) => s.undoBanner)
  const showUndo = useNoteUi((s) => s.showUndo)
  const restoreNote = useStore((s) => s.restoreNote)

  if (!banner) return null

  return (
    <div className="note-undo-banner" role="status" aria-live="polite">
      <span>已删除《{banner.title}》</span>
      <button
        type="button"
        onClick={() => {
          restoreNote(banner.noteId)
          showUndo(null)
        }}
      >
        撤销
      </button>
      <button type="button" aria-label="关闭提示" onClick={() => showUndo(null)}>
        ✕
      </button>
    </div>
  )
}

/** Recently updated notes, used by pages that have no note pane. */
export function useRecentNotes (limit = 5) {
  const notes = useStore((s) => s.notes)
  return useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit),
    [notes, limit]
  )
}
