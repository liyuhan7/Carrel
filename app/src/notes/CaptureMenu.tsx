// Capture menu: target note, placement preview and optional source link.
// Opens without taking focus; insertion never moves the caret into the note.

import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { uid } from '../lib/format'
import { capturePlacement, captureTargetNoteId, sourceLabel } from './capture'
import { placementLabel } from './placement'
import { openNoteAt } from './openNote'
import { useCaptureInsert } from './useCaptureInsert'
import { useNoteUi, type CaptureSourceInput } from './ui'
import './notes.css'

export interface CaptureMenuProps {
  source: CaptureSourceInput
  x: number
  y: number
  onClose: () => void
}

export function CaptureMenu ({ source, x, y, onClose }: CaptureMenuProps) {
  const notes = useStore((s) => s.notes)
  const activeNoteId = useStore((s) => s.workspace.activeNoteId)
  const positions = useStore((s) => s.notePositions)
  const blockMap = useStore((s) => s.noteBlocks)
  const files = useStore((s) => s.files)
  const createNote = useStore((s) => s.createNote)
  const undoInsert = useStore((s) => s.undoInsert)
  const notify = useStore((s) => s.notify)
  const lastTarget = useNoteUi((s) => s.lastTargetNoteId)
  const insertSource = useCaptureInsert()

  const [targetId, setTargetId] = useState(() => captureTargetNoteId(notes, activeNoteId, lastTarget) ?? '')
  const [withSource, setWithSource] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<{ operationId: string; blockId: string; label: string } | null>(null)
  // One operation id per menu: retries must not insert twice.
  const operationId = useRef(uid())

  const placement = useMemo(
    () => capturePlacement(positions[targetId], blockMap[targetId] ?? []),
    [positions, blockMap, targetId]
  )
  const target = notes.find((note) => note.id === targetId)
  const file = files.find((item) => item.id === source.fileId)

  const insert = async () => {
    if (!targetId) {
      notify('先新建一份笔记', 'error')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await insertSource(source, {
        targetNoteId: targetId,
        withSource,
        placement,
        operationId: operationId.current
      })
      setFeedback({
        operationId: operationId.current,
        blockId: result.insertedBlockId,
        label: `已加入《${target?.title || '笔记'}》`
      })
    } catch (err) {
      setError((err as Error).message || '插入失败')
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!feedback) return
    const ok = await undoInsert(feedback.operationId)
    if (!ok) {
      setError('撤销失败：插入记录已失效')
      return
    }
    setFeedback(null)
    setError('')
    notify('已撤销插入')
  }

  const left = Math.max(8, Math.min(x, window.innerWidth - 316))
  const top = Math.max(8, Math.min(y, window.innerHeight - 300))

  return (
    <div className="capture-menu" style={{ left, top }} role="dialog" aria-label="插入到笔记">
      <div className="capture-head">
        <span>加入</span>
        <select
          value={targetId}
          aria-label="目标笔记"
          onChange={(event) => setTargetId(event.target.value)}
        >
          {notes.map((note) => (
            <option key={note.id} value={note.id}>
              {note.title || '未命名笔记'}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => setTargetId(createNote())}
        >
          新建
        </button>
      </div>

      <p className="capture-placement">{placementLabel(placement, blockMap[targetId] ?? [])}</p>
      <p className="capture-quote">{source.text}</p>

      <label className="capture-source-toggle">
        <input type="checkbox" checked={withSource} onChange={(event) => setWithSource(event.target.checked)} />
        附来源链接（{sourceLabel(file?.name ?? source.fileName, source.page)}）
      </label>

      {error ? <p className="msg-error" role="alert">{error}</p> : null}

      {feedback ? (
        <div className="capture-feedback" role="status" aria-live="polite">
          <span>{feedback.label}</span>
          <button type="button" className="link" onClick={() => { openNoteAt(targetId, feedback.blockId); onClose() }}>
            打开
          </button>
          <button type="button" className="link" onClick={() => void undo()}>
            撤销
          </button>
          <button type="button" className="link" onClick={onClose}>
            关闭
          </button>
        </div>
      ) : (
        <div className="capture-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void insert()}>
            {busy ? '插入中…' : '插入'}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            取消
          </button>
        </div>
      )}
    </div>
  )
}
