// Shared capture action used by the reader entry and the notes-side menu.
// Keeps target resolution, placement and feedback in one place.

import { useStore } from '../store'
import type { CapturePlacement, InsertCaptureResult } from './contracts'
import { buildCaptureMarkdown, capturePlacement, sourceLabel } from './capture'
import { useNoteUi, type CaptureSourceInput } from './ui'

export function useCaptureInsert () {
  const insertCapture = useStore((s) => s.insertCapture)
  const ensureResource = useStore((s) => s.ensureResource)
  const files = useStore((s) => s.files)
  const flashInsert = useNoteUi((s) => s.flashInsert)
  const setFeedback = useNoteUi((s) => s.setFeedback)
  const setTargetNote = useNoteUi((s) => s.setTargetNote)

  return async (
    source: CaptureSourceInput,
    options: {
      targetNoteId: string
      withSource: boolean
      placement?: CapturePlacement
      operationId: string
    }
  ): Promise<InsertCaptureResult> => {
    const file = files.find((item) => item.id === source.fileId)
    const fileName = file?.name ?? source.fileName
    const resource = await ensureResource({
      kind: 'document',
      sourceId: source.fileId,
      title: fileName
    })
    const state = useStore.getState()
    const placement = options.placement ?? capturePlacement(
      state.notePositions[options.targetNoteId],
      state.noteBlocks[options.targetNoteId] ?? []
    )
    const result = await insertCapture({
      targetNoteId: options.targetNoteId,
      placement,
      contentMarkdown: buildCaptureMarkdown({
        quote: source.text,
        label: sourceLabel(fileName, source.page),
        withSource: options.withSource
      }),
      sourceCandidates: options.withSource
        ? [{
            resourceId: resource.id,
            selector: { type: 'document-text', page: source.page, quote: { exact: source.text } },
            relation: 'quotes',
            selected: true
          }]
        : [],
      operationId: options.operationId
    })
    flashInsert(options.targetNoteId, result.insertedBlockId, result.insertedRange.from, result.insertedRange.to)
    const title = state.notes.find((note) => note.id === options.targetNoteId)?.title ?? '笔记'
    setFeedback({
      noteId: options.targetNoteId,
      blockId: result.insertedBlockId,
      operationId: options.operationId,
      label: `已加入《${title}》`,
      at: Date.now()
    })
    setTargetNote(options.targetNoteId)
    return result
  }
}
