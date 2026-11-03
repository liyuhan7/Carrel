// Explicit relocation: only a user action may replace an Anchor's accepted
// position. The resolver itself never writes.

import type { ContentSelector, StateTransactionService } from '../shared/contracts/content'
import type { StagedTransaction } from '../shared/services/transactions'
import { isSelectorAllowed } from './selectors.ts'

export interface RelocationDeps {
  transactions: StateTransactionService
  anchorId: string
  selector: ContentSelector
  revision: string
  operationId?: string
}

export async function confirmAnchorRelocation(deps: RelocationDeps): Promise<void> {
  await deps.transactions.run(
    deps.operationId ?? `anchor:relocate:${deps.anchorId}:${deps.revision}`,
    (tx) => {
    const draft = (tx as StagedTransaction).draft
      const anchor = draft.anchors[deps.anchorId]
      if (!anchor) throw new Error('锚点不存在，无法更新位置')
      const resource = draft.resources[anchor.resourceId]
      if (!resource) throw new Error('来源资源不存在')
      if (!isSelectorAllowed(resource.kind, deps.selector)) {
        throw new Error('新位置与资源类型不匹配')
      }
      anchor.accepted = { revision: deps.revision, selector: deps.selector }
      anchor.updatedAt = Date.now()
    }
  )
}
