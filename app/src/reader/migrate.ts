// Stage 0 migration: legacy { fileId, page, rects, text, comment } annotations
// become { resourceId, anchorId, kind, body, style } + a document-text Anchor.
// Idempotent, keeps every original record, and never invents a creation-time
// revision that cannot be proven.

import type {
  AnchorCreateInput,
  AnchorService,
  ContentSelector,
  Rect,
  StateTransactionService,
  TextQuote
} from '../shared/contracts/content'
import type { Annotation, AnnotationStyle } from '../shared/contracts/reader'
import { normalizeRect } from './geometry.ts'
import { LEGACY_ANNOTATION_STYLE, validateAnnotation } from './validate.ts'

export { LEGACY_ANNOTATION_STYLE } from './validate.ts'

/** Marker revision for legacy records whose content version cannot be proven. */
export const LEGACY_UNKNOWN_REVISION = 'legacy:unknown'

export interface LegacyAnnotationRecord {
  id: string
  fileId: string
  page: number
  rects: Rect[]
  text: string
  comment?: string
  createdAt: number
}

export interface LegacyFileMeta {
  id: string
  name?: string
  hash: string
  mtime: number
}

export interface MigrationPlanItem {
  legacy: LegacyAnnotationRecord
  file: LegacyFileMeta
  revision: string
  selector: Extract<ContentSelector, { type: 'document-text' }>
  annotation: Annotation
}

export interface MigrationPlan {
  /** Already-migrated annotations that stay as they are. */
  annotations: Annotation[]
  /** Every raw legacy record ever seen, for recovery and retry. */
  legacy: LegacyAnnotationRecord[]
  pending: MigrationPlanItem[]
  invalid: number
}

export function isLegacyAnnotation (value: unknown): value is LegacyAnnotationRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<LegacyAnnotationRecord> & { anchorId?: unknown }
  return (
    typeof record.id === 'string' &&
    typeof record.fileId === 'string' &&
    typeof record.page === 'number' &&
    typeof record.text === 'string' &&
    Array.isArray(record.rects) &&
    typeof record.anchorId !== 'string'
  )
}

export function isMigratedAnnotation (value: unknown): value is Annotation {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<Annotation>
  return (
    typeof record.id === 'string' &&
    typeof record.resourceId === 'string' &&
    typeof record.anchorId === 'string' &&
    typeof record.kind === 'string' &&
    validateAnnotation(record as Annotation).ok
  )
}

/** Legacy rects were normalised against the rendered page box; keep them as-is. */
export function legacyRects (legacy: LegacyAnnotationRecord): Rect[] {
  if (!Array.isArray(legacy.rects)) return []
  return legacy.rects
    .map((rect) => normalizeRect(rect))
    .filter((rect): rect is Rect => Boolean(rect))
}

export function legacySelector (legacy: LegacyAnnotationRecord): Extract<ContentSelector, { type: 'document-text' }> {
  const quote: TextQuote = { exact: legacy.text }
  const rects = legacyRects(legacy)
  return {
    type: 'document-text',
    page: Math.max(1, Math.round(legacy.page || 1)),
    quote,
    ...(rects.length ? { rects } : {})
  }
}

/**
 * The current hash may stand in for the creation revision only when the file
 * was not modified after the annotation was created.
 */
export function legacyRevision (legacy: LegacyAnnotationRecord, file: LegacyFileMeta): string {
  if (Number.isFinite(file.mtime) && file.mtime <= legacy.createdAt) return file.hash
  return LEGACY_UNKNOWN_REVISION
}

export function legacyAnnotation (
  legacy: LegacyAnnotationRecord,
  resourceId: string,
  revision: string
): Annotation {
  const created = Number.isFinite(legacy.createdAt) ? legacy.createdAt : Date.now()
  const comment = typeof legacy.comment === 'string' ? legacy.comment.trim() : ''
  const annotation: Annotation = {
    id: legacy.id,
    resourceId,
    anchorId: `anchor-${legacy.id}`,
    kind: 'highlight',
    ...(comment ? { body: comment } : {}),
    style: { ...LEGACY_ANNOTATION_STYLE } as AnnotationStyle,
    createdAt: created,
    updatedAt: created
  }
  return annotation
}

function dedupeLegacy (records: LegacyAnnotationRecord[]): LegacyAnnotationRecord[] {
  const seen = new Set<string>()
  const result: LegacyAnnotationRecord[] = []
  for (const record of records) {
    if (!isLegacyAnnotation(record) || seen.has(record.id)) continue
    seen.add(record.id)
    result.push(record)
  }
  return result
}

export function planAnnotationMigration (input: {
  annotations: unknown[]
  legacyAnnotations?: unknown[]
  files: LegacyFileMeta[]
}): MigrationPlan {
  const annotations = input.annotations.filter(isMigratedAnnotation)
  const legacy = dedupeLegacy([
    ...(input.legacyAnnotations ?? []).filter(isLegacyAnnotation),
    ...input.annotations.filter(isLegacyAnnotation)
  ])
  const migratedIds = new Set(annotations.map((annotation) => annotation.id))
  const fileById = new Map(input.files.map((file) => [file.id, file]))
  const pending: MigrationPlanItem[] = []
  let invalid = 0

  for (const record of legacy) {
    if (migratedIds.has(record.id)) continue
    const file = fileById.get(record.fileId)
    if (!file) {
      invalid++
      continue
    }
    if (!record.text.trim()) {
      invalid++
      continue
    }
    const revision = legacyRevision(record, file)
    pending.push({
      legacy: record,
      file,
      revision,
      selector: legacySelector(record),
      annotation: legacyAnnotation(record, '', revision)
    })
  }

  return { annotations, legacy, pending, invalid }
}

export interface MigrationFailure {
  id: string
  message: string
}

export interface MigrationOutcome {
  annotations: Annotation[]
  legacyAnnotations: LegacyAnnotationRecord[]
  migrated: number
  failures: MigrationFailure[]
}

/**
 * Run the plan through AnchorService inside the shared transaction service.
 * A failed item keeps its raw record and is retried on the next hydrate.
 */
export async function migrateStoredAnnotations (input: {
  annotations: unknown[]
  legacyAnnotations?: unknown[]
  files: LegacyFileMeta[]
  ensureResource(file: LegacyFileMeta): Promise<string | null>
  anchorService: AnchorService
  transactions: StateTransactionService
  now?: () => number
}): Promise<MigrationOutcome> {
  const plan = planAnnotationMigration(input)
  const outcome: MigrationOutcome = {
    annotations: [...plan.annotations],
    legacyAnnotations: plan.legacy,
    migrated: 0,
    failures: []
  }

  for (const item of plan.pending) {
    try {
      const resourceId = await input.ensureResource(item.file)
      if (!resourceId) throw new Error('无法建立资料资源')
      const annotation: Annotation = { ...item.annotation, resourceId }
      const check = validateAnnotation(annotation)
      if (!check.ok) throw new Error(check.reason)
      const anchorInput: AnchorCreateInput = {
        id: annotation.anchorId,
        resourceId,
        revision: item.revision,
        selector: item.selector,
        snapshot: {
          text: item.legacy.text,
          ...(item.selector.quote.prefix ? { prefix: item.selector.quote.prefix } : {}),
          ...(item.selector.quote.suffix ? { suffix: item.selector.quote.suffix } : {}),
          label: `第 ${item.selector.page} 页`
        }
      }
      await input.transactions.run(`migrate-annotation:${item.legacy.id}`, (tx) => {
        input.anchorService.createOrReuse(anchorInput, tx)
      })
      outcome.annotations.push(annotation)
      outcome.migrated++
    } catch (error) {
      outcome.failures.push({
        id: item.legacy.id,
        message: error instanceof Error ? error.message : '迁移失败'
      })
    }
  }

  return outcome
}
