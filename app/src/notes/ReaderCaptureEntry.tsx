// Marker-block entry for the reading module: one click inserts into the remembered
// target note at its writing position; the caret stays in the reader.
//
// Integration (reading module, inside its selection popup):
//   {/* >>> integration:reading-annotation */}
//   <ReaderCaptureEntry
//     fileId={file.id} fileName={file.name} page={page}
//     text={popup.text} x={popup.x} y={popup.y}
//     onClose={() => setPopup(null)}
//   />
//   {/* <<< integration:reading-annotation */}

import { useRef, useState } from 'react'
import { useStore } from '../store'
import { uid } from '../lib/format'
import { captureTargetNoteId } from './capture'
import { CaptureMenu } from './CaptureMenu'
import { useCaptureInsert } from './useCaptureInsert'
import { useNoteUi } from './ui'
import './notes.css'

export interface ReaderCaptureEntryProps {
  fileId: string
  fileName: string
  page: number
  text: string
  x: number
  y: number
  onClose?: () => void
}

export function ReaderCaptureEntry ({ fileId, fileName, page, text, x, y, onClose }: ReaderCaptureEntryProps) {
  const notes = useStore((s) => s.notes)
  const activeNoteId = useStore((s) => s.workspace.activeNoteId)
  const lastTarget = useNoteUi((s) => s.lastTargetNoteId)
  const insertSource = useCaptureInsert()
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operationId = useRef(uid())

  const targetId = captureTargetNoteId(notes, activeNoteId, lastTarget)
  const target = notes.find((note) => note.id === targetId)
  const source = { fileId, fileName, page, text }

  const insertNow = async () => {
    if (!targetId) {
      setError('先新建一份笔记')
      return
    }
    setBusy(true)
    setError('')
    try {
      await insertSource(source, {
        targetNoteId: targetId,
        withSource: true,
        operationId: operationId.current
      })
      onClose?.()
    } catch (err) {
      setError((err as Error).message || '插入失败')
    } finally {
      setBusy(false)
    }
  }

  const left = Math.max(8, Math.min(x, window.innerWidth - 220))
  const top = Math.max(8, Math.min(y, window.innerHeight - 60))

  return (
    <div className="reader-capture" style={{ left, top }}>
      <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void insertNow()}>
        {busy ? '插入中…' : `加入《${target?.title || '笔记'}》`}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        aria-label="选择目标笔记与落点"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      >
        ▾
      </button>
      {error ? <span className="reader-capture-error" role="alert">{error}</span> : null}
      {menuOpen && targetId ? (
        <CaptureMenu source={source} x={left} y={top + 34} onClose={() => setMenuOpen(false)} />
      ) : null}
    </div>
  )
}
