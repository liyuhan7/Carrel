// Atomic note insertion: one command for reader captures, AI drafts and in-note
// source insertion. Body, block map and source links commit together.

import type {
  AnchorService, ContentLink, LinkService, StateTransaction
} from '../shared/contracts/content'
import type {
  CapturePlacement, InsertCaptureCommand, InsertCaptureResult, NoteBlock,
  NoteSourceCandidate, WritingPosition
} from './contracts'
import { reconcileBlocks, revisionOf } from './blocks.ts'
import { computeInsertion } from './placement.ts'

/** Note document change committed in the same store write as the shared slices. */
export interface NoteDocumentCommit {
  noteId: string
  body: string
  blocks: NoteBlock[]
  position: WritingPosition
}

export interface NoteInsertDeps {
  readNote: (noteId: string) => { body: string; title: string } | undefined
  readBlocks: (noteId: string) => NoteBlock[]
  readPosition: (noteId: string) => WritingPosition | undefined
  readResource: (resourceId: string) => {
    id: string
    kind: string
    sourceId: string
    availability: string
    revision: string
  } | undefined
  readNoteResourceId: (noteId: string) => string | undefined
  /** Staged by the data layer and consumed by its commit write. */
  stageNoteDocument: (doc: NoteDocumentCommit | null) => void
  anchorService: AnchorService
  linkService: LinkService
  now: () => number
  nextId: () => string
}

export interface InsertRecord {
  operationId: string
  noteId: string
  before: NoteDocumentCommit
  result: InsertCaptureResult
  linkIds: string[]
  anchorIds: string[]
  at: number
}

const RECORD_LIMIT = 20

/** `csref:NEW` / `csref:NEW2` become the ids of the links created in this command. */
export function resolvePlaceholders (content: string, linkIds: string[]): string {
  return content.replace(/csref:NEW(\d+)?/g, (_match, raw: string | undefined) => {
    const index = raw ? Number(raw) - 1 : 0
    return linkIds[index] ? `csref:${linkIds[index]}` : 'csref:missing'
  })
}

function emptyPosition (noteId: string, body: string, now: number): WritingPosition {
  return {
    noteId,
    docRevision: revisionOf(body),
    selection: { from: 0, to: 0 },
    scrollTop: 0,
    updatedAt: now
  }
}

export function createNoteInsertService (deps: NoteInsertDeps) {
  const applied = new Map<string, InsertCaptureResult>()
  const records = new Map<string, InsertRecord>()
  const order: string[] = []

  const remember = (record: InsertRecord): void => {
    records.set(record.operationId, record)
    order.push(record.operationId)
    while (order.length > RECORD_LIMIT) {
      const oldest = order.shift()
      if (!oldest) break
      records.delete(oldest)
      applied.delete(oldest)
    }
  }

  return {
    /**
     * Inserts `contentMarkdown` at a structural boundary, optionally creating the
     * source anchors/links. Everything is staged on the transaction draft; a throw
     * discards the whole operation, including the note body.
     */
    async insertCapture (
      command: InsertCaptureCommand,
      tx: StateTransaction
    ): Promise<InsertCaptureResult> {
      const operationId = command.operationId ?? deps.nextId()
      const done = applied.get(operationId)
      if (done) return done

      try {
        const note = deps.readNote(command.targetNoteId)
        if (!note) throw new Error('目标笔记不存在')

        const previousPosition = deps.readPosition(command.targetNoteId) ?? emptyPosition(command.targetNoteId, note.body, deps.now())
        const previousRevision = revisionOf(note.body)
        const prevBlocks = deps.readBlocks(command.targetNoteId)
        const blocks = reconcileBlocks({
          noteId: command.targetNoteId,
          prev: prevBlocks,
          body: note.body,
          docRevision: previousRevision,
          now: deps.now(),
          nextId: deps.nextId
        })

        const candidates = (command.sourceCandidates ?? []).filter((candidate) => candidate.selected)
        const noteResourceId = deps.readNoteResourceId(command.targetNoteId)
        if (candidates.length > 0 && !noteResourceId) throw new Error('笔记来源资源未就绪')
        // Link ids are known before insertion so csref placeholders resolve exactly.
        const linkIds = candidates.map(() => deps.nextId())
        const content = resolvePlaceholders(command.contentMarkdown, linkIds)

        const insertion = computeInsertion(note.body, blocks, command.placement, content)
        const nextRevision = revisionOf(insertion.body)
        const nextBlocks = reconcileBlocks({
          noteId: command.targetNoteId,
          prev: blocks,
          body: insertion.body,
          docRevision: nextRevision,
          now: deps.now(),
          nextId: deps.nextId,
          forceNewRange: { from: insertion.from, to: insertion.to }
        })
        const insertedBlock =
          nextBlocks.find((block) => block.from <= insertion.from && insertion.from < block.to) ??
          nextBlocks.find((block) => block.from === insertion.from)
        if (!insertedBlock) throw new Error('插入失败：无法定位新块')

        const position: WritingPosition = {
          noteId: command.targetNoteId,
          blockId: insertedBlock.blockId,
          blockOffset: insertion.to - insertedBlock.from,
          selection: { from: insertion.to, to: insertion.to },
          docRevision: nextRevision,
          scrollTop: previousPosition.scrollTop,
          updatedAt: deps.now()
        }

        const anchorIds: string[] = []
        const createdLinkIds: string[] = []
        if (candidates.length > 0 && noteResourceId) {
          const noteAnchor = deps.anchorService.createOrReuse(
            {
              id: deps.nextId(),
              resourceId: noteResourceId,
              revision: nextRevision,
              selector: { type: 'note-block', blockId: insertedBlock.blockId, quote: { exact: content.trim() } },
              snapshot: { text: content.trim() }
            },
            tx
          )
          anchorIds.push(noteAnchor.id)
          candidates.forEach((candidate: NoteSourceCandidate, index: number) => {
            const resource = deps.readResource(candidate.resourceId)
            if (!resource) throw new Error('来源资源不存在')
            const anchor = deps.anchorService.createOrReuse(
              {
                id: deps.nextId(),
                resourceId: candidate.resourceId,
                revision: resource.revision,
                selector: candidate.selector,
                snapshot: {
                  text: candidate.selector.type === 'document-text' ? candidate.selector.quote.exact : undefined
                }
              },
              tx
            )
            anchorIds.push(anchor.id)
            const link: ContentLink = {
              id: linkIds[index],
              fromAnchorId: noteAnchor.id,
              toAnchorId: anchor.id,
              relation: candidate.relation,
              createdBy: 'user',
              verification: candidate.relation === 'quotes' ? 'user_confirmed' : 'unverified',
              createdAt: deps.now()
            }
            deps.linkService.createLink(link, tx)
            createdLinkIds.push(link.id)
          })
        }

        deps.stageNoteDocument({
          noteId: command.targetNoteId,
          body: insertion.body,
          blocks: nextBlocks,
          position
        })

        const result: InsertCaptureResult = {
          noteId: command.targetNoteId,
          insertedBlockId: insertedBlock.blockId,
          insertedRange: { from: insertion.from, to: insertion.to },
          createdLinkIds,
          placementFallback: insertion.fallback
        }
        applied.set(operationId, result)
        remember({
          operationId,
          noteId: command.targetNoteId,
          before: {
            noteId: command.targetNoteId,
            body: note.body,
            blocks: prevBlocks,
            position: previousPosition
          },
          result,
          linkIds: createdLinkIds,
          anchorIds,
          at: deps.now()
        })
        return result
      } catch (error) {
        deps.stageNoteDocument(null)
        throw error
      }
    },

    /** Reverts a previous insert, removing links/anchors created by that command. */
    async undo (operationId: string, tx: StateTransaction): Promise<NoteDocumentCommit | null> {
      const record = records.get(operationId)
      if (!record) return null
      deps.stageNoteDocument(record.before)
      for (const linkId of record.linkIds) deps.linkService.removeLink(linkId, tx)
      for (const anchorId of record.anchorIds) deps.anchorService.removeIfUnused(anchorId, tx)
      records.delete(operationId)
      applied.delete(operationId)
      const index = order.indexOf(operationId)
      if (index >= 0) order.splice(index, 1)
      return record.before
    },

    /** Result of an operation that was already applied; used for retries. */
    appliedResult (operationId: string): InsertCaptureResult | undefined {
      return applied.get(operationId)
    }
  }
}

export type NoteInsertService = ReturnType<typeof createNoteInsertService>
