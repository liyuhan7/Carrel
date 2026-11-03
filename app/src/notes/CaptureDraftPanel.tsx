// AI answer draft: the user edits the excerpt before anything reaches a note.
// Cancelling writes nothing; confirming inserts body and selected sources together.

import { useState } from 'react'
import { useStore } from '../store'
import { capturePlacement } from './capture'
import { useNoteUi } from './ui'
import './notes.css'

export function CaptureDraftPanel () {
  const draft = useNoteUi((s) => s.draft)
  const updateDraft = useNoteUi((s) => s.updateDraft)
  const closeDraft = useNoteUi((s) => s.closeDraft)
  const notes = useStore((s) => s.notes)
  const resources = useStore((s) => s.resources)
  const positions = useStore((s) => s.notePositions)
  const blocks = useStore((s) => s.noteBlocks)
  const insertCapture = useStore((s) => s.insertCapture)
  const notify = useStore((s) => s.notify)
  const flashInsert = useNoteUi((s) => s.flashInsert)
  const setFeedback = useNoteUi((s) => s.setFeedback)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!draft) return null

  const selected = draft.sourceCandidates.filter((candidate) => candidate.selected)
  const sourceLines = selected
    .map((candidate, index) => {
      if (candidate.selector.type !== 'document-text') return ''
      const resource = resources[candidate.resourceId]
      return `[来源：${resource?.title ?? '资料'} · 第 ${candidate.selector.page} 页](csref:NEW${index + 1})`
    })
    .filter(Boolean)
    .join('\n')
  const content = draft.content.trim()
  const markdown = sourceLines ? `${content}\n\n${sourceLines}` : content
  const target = notes.find((note) => note.id === draft.targetNoteId)
  const placementAtPosition = capturePlacement(positions[draft.targetNoteId], blocks[draft.targetNoteId] ?? [])

  const confirm = async () => {
    if (!content) {
      setError('草稿为空，先写一点内容')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await insertCapture({
        targetNoteId: draft.targetNoteId,
        placement: draft.placement,
        contentMarkdown: markdown,
        sourceCandidates: draft.sourceCandidates,
        operationId: draft.id
      })
      flashInsert(draft.targetNoteId, result.insertedBlockId, result.insertedRange.from, result.insertedRange.to)
      setFeedback({
        noteId: draft.targetNoteId,
        blockId: result.insertedBlockId,
        operationId: draft.id,
        label: `已加入《${target?.title || '笔记'}》`,
        at: Date.now()
      })
      closeDraft()
      notify('已插入整理后的内容')
    } catch (err) {
      setError((err as Error).message || '插入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="note-draft-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) closeDraft() }}>
      <section className="note-draft" role="dialog" aria-label="整理 AI 回答到笔记">
        <div className="note-draft-head">
          <h2>整理到笔记</h2>
          <span className="hint">确认后才会写入，原始回答不会改变</span>
        </div>

        <div className="note-draft-body">
          <textarea
            value={draft.content}
            aria-label="整理草稿"
            placeholder="删减、改写或补充自己的理解"
            onChange={(event) => updateDraft({ content: event.target.value })}
          />

          <div className="note-draft-row">
            <label htmlFor="draft-target">目标笔记</label>
            <select
              id="draft-target"
              value={draft.targetNoteId}
              onChange={(event) => {
                const targetNoteId = event.target.value
                updateDraft({
                  targetNoteId,
                  placement: capturePlacement(positions[targetNoteId], blocks[targetNoteId] ?? [])
                })
              }}
            >
              {notes.map((note) => (
                <option key={note.id} value={note.id}>
                  {note.title || '未命名笔记'}
                </option>
              ))}
            </select>

            <label htmlFor="draft-placement">落点</label>
            <select
              id="draft-placement"
              value={draft.placement.kind === 'append' ? 'append' : 'position'}
              onChange={(event) => updateDraft({
                placement: event.target.value === 'append' ? { kind: 'append' } : placementAtPosition
              })}
            >
              <option value="position">当前写作位置之后</option>
              <option value="append">文末</option>
            </select>
          </div>

          <div className="note-draft-sources">
            <p>来源（默认“整理自”，可取消；取消后不创建任何来源链接）</p>
            {draft.sourceCandidates.length === 0 ? (
              <p className="note-source-empty">这条回答没有可核实的引用，插入后不产生来源</p>
            ) : (
              draft.sourceCandidates.map((candidate, index) => {
                const resource = resources[candidate.resourceId]
                const label = candidate.selector.type === 'document-text'
                  ? `${resource?.title ?? '资料'} · 第 ${candidate.selector.page} 页`
                  : candidate.selector.type === 'message'
                    ? `${resource?.title ?? 'AI 学习助手'} · 回答原文`
                    : resource?.title ?? '来源'
                return (
                  <label key={`${candidate.resourceId}-${index}`} className="note-draft-source">
                    <input
                      type="checkbox"
                      checked={candidate.selected}
                      onChange={(event) => {
                        const sourceCandidates = draft.sourceCandidates.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, selected: event.target.checked } : item
                        )
                        updateDraft({ sourceCandidates })
                      }}
                    />
                    <span>{label}</span>
                    <span className="hint">{candidate.relation === 'quotes' ? '引用' : '整理自'}</span>
                  </label>
                )
              })
            )}
          </div>

          {error ? <p className="msg-error" role="alert">{error}</p> : null}
        </div>

        <div className="note-draft-foot">
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void confirm()}>
            {busy ? '插入中…' : '确认插入'}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={closeDraft}>
            取消
          </button>
          <span className="tool-spacer" />
          <span className="hint">取消不会写入正文、来源或链接</span>
        </div>
      </section>
    </div>
  )
}
