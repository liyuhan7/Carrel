// Annotation CRUD on top of the shared Anchor service.
// Anchor creation and annotation persistence happen inside one transaction;
// removing an annotation only recycles its anchor when nothing else uses it.

import type { Anchor, AnchorService, StateTransactionService } from '../shared/contracts/content'
import type {
  Annotation,
  AnnotationKind,
  AnnotationService,
  AnnotationStyle,
  SelectionDraft
} from '../shared/contracts/reader'
import { cleanBody, normalizeStyle, validateAnnotationDraft, validateBody, validateStyle } from './validate.ts'

export interface AnnotationPort {
  read(): Annotation[]
  write(next: Annotation[]): void
  now(): number
  nextId(): string
}

export interface AnnotationServiceDeps {
  port: AnnotationPort
  anchorService: AnchorService
  transactions: StateTransactionService
}

export interface ReaderAnnotationService extends AnnotationService {
  get(annotationId: string): Annotation | undefined
  canUndo(resourceId: string): boolean
  undoLabel(resourceId: string): string | null
  /** Undo the last annotation operation on one document. */
  undo(resourceId: string): Promise<boolean>
}

interface UndoEntry {
  resourceId: string
  label: string
  run(): Promise<void>
}

const MAX_UNDO = 60

export function createAnnotationService (deps: AnnotationServiceDeps): ReaderAnnotationService {
  const { port, anchorService, transactions } = deps
  const undoStack = new Map<string, UndoEntry[]>()

  const pushUndo = (entry: UndoEntry) => {
    const stack = undoStack.get(entry.resourceId) ?? []
    stack.push(entry)
    if (stack.length > MAX_UNDO) stack.splice(0, stack.length - MAX_UNDO)
    undoStack.set(entry.resourceId, stack)
  }

  const removeInternal = async (annotationId: string): Promise<void> => {
    const before = port.read()
    const current = before.find((annotation) => annotation.id === annotationId)
    if (!current) return
    try {
      await transactions.run(`annotation:remove:${annotationId}`, (tx) => {
        // Publish the deletion first so isAnchorUsed() sees this annotation as gone.
        port.write(before.filter((annotation) => annotation.id !== annotationId))
        anchorService.removeIfUnused(current.anchorId, tx)
      })
    } catch (error) {
      port.write(before)
      throw error
    }
  }

  const restore = async (annotation: Annotation, savedAnchor?: Anchor): Promise<void> => {
    const anchor = savedAnchor ?? anchorService.getAnchor(annotation.anchorId)
    const current = port.read()
    if (current.some((item) => item.id === annotation.id)) return
    if (!anchor) {
      port.write([...current, annotation])
      return
    }
    try {
      await transactions.run(`annotation:restore:${annotation.id}`, (tx) => {
        const restored = anchorService.createOrReuse(
          {
            id: anchor.id,
            resourceId: anchor.resourceId,
            revision: anchor.accepted.revision,
            selector: anchor.accepted.selector,
            snapshot: anchor.snapshot
          },
          tx
        )
        // createOrReuse may return a shared anchor with a different id.
        port.write([...port.read(), { ...annotation, anchorId: restored.id }])
      })
    } catch (error) {
      throw error
    }
  }

  const service: ReaderAnnotationService = {
    list (resourceId) {
      return port
        .read()
        .filter((annotation) => annotation.resourceId === resourceId)
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    get (annotationId) {
      return port.read().find((annotation) => annotation.id === annotationId)
    },

    async create (input) {
      const check = validateAnnotationDraft(input)
      if (!check.ok) throw new Error(check.reason)
      const { selection } = input
      const kind: AnnotationKind = input.kind
      const style = normalizeStyle(input.style, kind)
      const body = cleanBody(input.body)
      const bodyCheck = validateBody(kind, body)
      if (!bodyCheck.ok) throw new Error(bodyCheck.reason)

      const id = port.nextId()
      const anchorId = port.nextId()
      const now = port.now()
      const before = port.read()
      const selector = selection.selector
      const page = selector.type === 'document-text' || selector.type === 'document-region' ? selector.page : undefined
      const snapshot = {
        ...(selection.kind === 'text' ? { text: selection.text } : {}),
        ...(selector.type === 'document-text' && selector.quote.prefix ? { prefix: selector.quote.prefix } : {}),
        ...(selector.type === 'document-text' && selector.quote.suffix ? { suffix: selector.quote.suffix } : {}),
        ...(page ? { label: `第 ${page} 页` } : {})
      }
      let created: Annotation | null = null

      try {
        await transactions.run(`annotation:create:${id}`, (tx) => {
          const anchor = anchorService.createOrReuse(
            {
              id: anchorId,
              resourceId: selection.resourceId,
              revision: selection.revision,
              selector,
              snapshot
            },
            tx
          )
          created = {
            id,
            resourceId: selection.resourceId,
            anchorId: anchor.id,
            kind,
            ...(body ? { body } : {}),
            style,
            createdAt: now,
            updatedAt: now
          }
          // Persisted in the same transaction callback; rolled back on throw below.
          port.write([...before, created])
        })
      } catch (error) {
        port.write(before)
        throw error
      }

      const annotation = created as Annotation | null
      if (!annotation) throw new Error('标注创建失败')
      pushUndo({
        resourceId: annotation.resourceId,
        label: '创建标注',
        run: () => removeInternal(annotation.id)
      })
      return annotation
    },

    async update (annotationId, changes) {
      const before = port.read()
      const current = before.find((annotation) => annotation.id === annotationId)
      if (!current) throw new Error('标注不存在或已删除')
      if (changes.body !== undefined) {
        const bodyCheck = validateBody(current.kind, changes.body)
        if (!bodyCheck.ok) throw new Error(bodyCheck.reason)
      }
      if (changes.style !== undefined) {
        const styleCheck = validateStyle(changes.style)
        if (!styleCheck.ok) throw new Error(styleCheck.reason)
      }
      const body = changes.body === undefined ? current.body : cleanBody(changes.body)
      const next: Annotation = {
        ...current,
        ...(body ? { body } : {}),
        ...(body ? {} : { body: undefined }),
        style: changes.style ? { ...current.style, ...changes.style } : current.style,
        updatedAt: port.now()
      }
      port.write(before.map((annotation) => (annotation.id === annotationId ? next : annotation)))
      pushUndo({
        resourceId: current.resourceId,
        label: '修改标注',
        run: async () => {
          port.write(port.read().map((annotation) => (annotation.id === annotationId ? current : annotation)))
        }
      })
    },

    async remove (annotationId) {
      const before = port.read()
      const current = before.find((annotation) => annotation.id === annotationId)
      if (!current) return
      // Snapshot the anchor before removeIfUnused may recycle it, so undo can
      // restore the exact position even when the anchor had no other users.
      const savedAnchor = anchorService.getAnchor(current.anchorId)
      await removeInternal(annotationId)
      pushUndo({
        resourceId: current.resourceId,
        label: '删除标注',
        run: () => restore(current, savedAnchor)
      })
    },

    canUndo (resourceId) {
      return (undoStack.get(resourceId)?.length ?? 0) > 0
    },

    undoLabel (resourceId) {
      const stack = undoStack.get(resourceId)
      return stack?.length ? stack[stack.length - 1].label : null
    },

    async undo (resourceId) {
      const stack = undoStack.get(resourceId)
      if (!stack?.length) return false
      const entry = stack.pop() as UndoEntry
      try {
        await entry.run()
        return true
      } catch (error) {
        stack.push(entry)
        throw error
      }
    }
  }

  return service
}
