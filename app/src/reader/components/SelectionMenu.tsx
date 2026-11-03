// Floating menu for a fresh text/region selection. The draft behind it is
// in-memory only; closing the menu drops it and creates nothing.

import { useEffect, useState } from 'react'
import type { AnnotationKind } from '../../shared/contracts/reader'

interface SelectionMenuProps {
  x: number
  y: number
  text: string
  initialNote?: boolean
  onClose: () => void
  onHighlight: (kind: Extract<AnnotationKind, 'highlight' | 'underline' | 'strikethrough'>) => void
  onNote: (body: string) => void
  onCopy: () => void
  onAsk: () => void
  onExplain: () => void
  onAddToNote: () => void
}

export function SelectionMenu ({
  x,
  y,
  text,
  initialNote,
  onClose,
  onHighlight,
  onNote,
  onCopy,
  onAsk,
  onExplain,
  onAddToNote
}: SelectionMenuProps) {
  const [noteMode, setNoteMode] = useState(Boolean(initialNote))
  const [body, setBody] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const left = typeof window === 'undefined' ? x : Math.max(8, Math.min(x, window.innerWidth - 372))
  const top = typeof window === 'undefined' ? y : Math.max(8, Math.min(y + 16, window.innerHeight - 210))

  if (noteMode) {
    return (
      <div className="selection-pop selection-note" role="dialog" aria-label="添加批注" style={{ left, top }}>
        <p className="selection-quote">{text.length > 90 ? `${text.slice(0, 90)}…` : text}</p>
        <textarea
          autoFocus
          rows={3}
          value={body}
          placeholder="写下这条批注（必填，纯文本）"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              if (body.trim()) onNote(body)
            }
          }}
        />
        <div className="selection-note-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="is-primary" disabled={!body.trim()} onClick={() => onNote(body)}>
            保存批注
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="selection-pop" role="menu" style={{ left, top }}>
      <button type="button" onClick={() => onHighlight('highlight')}>
        高亮
      </button>
      <button type="button" onClick={() => onHighlight('underline')}>
        下划线
      </button>
      <button type="button" onClick={() => onHighlight('strikethrough')}>
        删除线
      </button>
      <button type="button" onClick={() => setNoteMode(true)}>
        批注
      </button>
      <button type="button" onClick={onCopy}>
        复制
      </button>
      <button type="button" onClick={onAsk}>
        向 AI 提问
      </button>
      <button type="button" onClick={onExplain}>
        AI 解释
      </button>
      {/* >>> integration:note-capture — the note module mounts its CaptureMenu here. */}
      <button type="button" onClick={onAddToNote}>
        加入笔记
      </button>
      {/* <<< integration:note-capture */}
    </div>
  )
}
