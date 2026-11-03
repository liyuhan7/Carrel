// Popover for an existing annotation: source excerpt, comment, colour, edit,
// delete, ask AI and send to notes. Also lists overlapping annotations.

import { useState } from 'react'
import type { AnnotationStyle, ResolvedAnnotation } from '../../shared/contracts/reader'
import { STATUS_HINT, STATUS_LABEL } from '../annotationResolve'
import { KIND_LABEL } from './AnnotationSidebar'

const PALETTE = ['#d9c48f', '#5f6f79', '#6d8272', '#a4685c', '#8a7ba6']

interface PopoverProps {
  x: number
  y: number
  items: ResolvedAnnotation[]
  quote: string
  onClose: () => void
  onUpdate: (annotationId: string, changes: { body?: string; style?: AnnotationStyle }) => Promise<void>
  onRemove: (annotationId: string) => Promise<void>
  onAsk: (item: ResolvedAnnotation) => void
  onAddToNote: (item: ResolvedAnnotation) => void
}

export function AnnotationPopover ({
  x,
  y,
  items,
  quote,
  onClose,
  onUpdate,
  onRemove,
  onAsk,
  onAddToNote
}: PopoverProps) {
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const item = items[Math.min(index, items.length - 1)]
  if (!item) return null
  const annotation = item.annotation

  const left = typeof window === 'undefined' ? x : Math.max(8, Math.min(x, window.innerWidth - 340))
  const top = typeof window === 'undefined' ? y : Math.max(8, Math.min(y + 14, window.innerHeight - 260))

  const startEdit = () => {
    setBody(annotation.body ?? '')
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onUpdate(annotation.id, { body })
      setEditing(false)
    } catch {
      // Validation message comes from the store; keep the editor open.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="anno-popover" role="dialog" aria-label="标注详情" style={{ left, top }}>
      <div className="anno-popover-head">
        <span className="ann-swatch" style={{ background: annotation.style.color }} />
        <span className="anno-popover-kind">{KIND_LABEL[annotation.kind]}</span>
        {item.page ? <span className="anno-popover-page">第 {item.page} 页</span> : null}
        <span className="tool-spacer" />
        <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
          ✕
        </button>
      </div>

      {items.length > 1 ? (
        <div className="anno-popover-candidates">
          <span className="muted">此处有 {items.length} 条标注重叠：</span>
          {items.map((candidate, candidateIndex) => (
            <button
              key={candidate.annotation.id}
              type="button"
              className={`link${candidateIndex === index ? ' is-active' : ''}`}
              onClick={() => setIndex(candidateIndex)}
            >
              {KIND_LABEL[candidate.annotation.kind]}
              {candidateIndex === index ? ' ✓' : ''}
            </button>
          ))}
        </div>
      ) : null}

      {quote ? <p className="anno-popover-quote">{quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}</p> : null}

      {item.status !== 'ok' ? (
        <p className="anno-popover-status">{STATUS_LABEL[item.status]}：{STATUS_HINT[item.status]}</p>
      ) : null}

      {editing ? (
        <div className="anno-popover-editor">
          <textarea
            autoFocus
            rows={3}
            value={body}
            placeholder={annotation.kind === 'note' ? '批注正文（必填）' : '批注（可选）'}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="anno-popover-row">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className={`ann-color${annotation.style.color === color ? ' is-active' : ''}`}
                style={{ background: color }}
                aria-label={`颜色 ${color}`}
                onClick={() => {
                  void onUpdate(annotation.id, { style: { ...annotation.style, color } }).catch(() => undefined)
                }}
              />
            ))}
            <span className="tool-spacer" />
            <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary btn-small" disabled={saving} onClick={() => void save()}>
              保存
            </button>
          </div>
        </div>
      ) : (
        <>
          {annotation.body ? <p className="anno-popover-body">{annotation.body}</p> : null}
          <div className="anno-popover-actions">
            <button type="button" className="link" onClick={startEdit}>
              编辑
            </button>
            <button type="button" className="link" onClick={() => onAsk(item)}>
              向 AI 提问
            </button>
            <button type="button" className="link" onClick={() => onAddToNote(item)}>
              整理到笔记
            </button>
            <button type="button" className="link is-danger" onClick={() => void onRemove(annotation.id)}>
              删除
            </button>
          </div>
        </>
      )}
    </div>
  )
}
