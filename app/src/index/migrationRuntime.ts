// Applies the legacy NoteRef plan through one shared transaction, using the
// shared Anchor/Link services so endpoint validation stays in one place.
// A no-op plan does not open a transaction.

import type {
  Anchor,
  AnchorService,
  ContentLink,
  LinkService,
  Resource,
  StateTransactionService
} from '../shared/contracts/content'
import type { FileRec, Note } from '../types'
import type { StagedTransaction } from '../shared/services/transactions'
import { planLegacyRefMigration, type LegacyRefPlan } from './migrate.ts'

export interface LegacyRefMigrationDeps {
  transactions: StateTransactionService
  anchorService: AnchorService
  linkService: LinkService
  resources: Record<string, Resource>
  anchors: Record<string, Anchor>
  links: Record<string, ContentLink>
  files: FileRec[]
  notes: Note[]
  operationId?: string
}

export async function migrateLegacyRefs(deps: LegacyRefMigrationDeps): Promise<LegacyRefPlan> {
  const preview = planLegacyRefMigration({
    resources: deps.resources,
    anchors: deps.anchors,
    links: deps.links,
    files: deps.files,
    notes: deps.notes
  })
  const nothingToDo =
    !preview.createdAnchorIds.length &&
    !preview.createdLinkIds.length &&
    !preview.createdResourceIds.length
  if (nothingToDo) return preview

  return deps.transactions.run(deps.operationId ?? `legacy-refs:migrate:${Date.now()}`, (tx) => {
    const draft = (tx as StagedTransaction).draft
    const plan = planLegacyRefMigration({
      resources: draft.resources,
      anchors: draft.anchors,
      links: draft.links,
      files: deps.files,
      notes: deps.notes
    })
    for (const resource of plan.resourceUpserts) draft.resources[resource.id] = resource

    const actualAnchorIds = new Map<string, string>()
    for (const input of plan.anchorInputs) {
      const anchor = deps.anchorService.createOrReuse(input, tx)
      actualAnchorIds.set(input.id, anchor.id)
    }
    for (const link of plan.linkInputs) {
      if (draft.links[link.id]) continue
      deps.linkService.createLink(
        {
          ...link,
          fromAnchorId: actualAnchorIds.get(link.fromAnchorId) ?? link.fromAnchorId,
          toAnchorId: actualAnchorIds.get(link.toAnchorId) ?? link.toAnchorId
        },
        tx
      )
    }
    return plan
  })
}
