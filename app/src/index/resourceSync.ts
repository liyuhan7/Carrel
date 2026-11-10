// Applies the resource plan through one shared transaction.
// Nothing is written when the plan has no changes, so a store subscription
// cannot feed itself.

import type { Resource, StateTransactionService } from '../shared/contracts/content'
import type { ChatMessage, FileRec, Note, Session } from '../types'
import type { StagedTransaction } from '../shared/services/transactions'
import { planResourceSync, type ResourceSyncPlan } from './resources.ts'

export interface ResourceSyncDeps {
  transactions: StateTransactionService
  /** Committed resources slice, used to detect a no-op sync. */
  resources: Record<string, Resource>
  files: FileRec[]
  notes: Note[]
  sessions?: Session[]
  messages: ChatMessage[]
  operationId?: string
}

export async function syncResourceRegistry(deps: ResourceSyncDeps): Promise<ResourceSyncPlan> {
  const preview = planResourceSync({
    resources: deps.resources,
    files: deps.files,
    notes: deps.notes,
    sessions: deps.sessions,
    messages: deps.messages
  })
  if (!preview.upserts.length) return preview

  return deps.transactions.run(deps.operationId ?? `resources:sync:${Date.now()}`, (tx) => {
    const draft = (tx as StagedTransaction).draft
    const plan = planResourceSync({
      resources: draft.resources,
      files: deps.files,
      notes: deps.notes,
      sessions: deps.sessions,
      messages: deps.messages
    })
    for (const resource of plan.upserts) draft.resources[resource.id] = resource
    return plan
  })
}
