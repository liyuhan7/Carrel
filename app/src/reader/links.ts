// Reading-side link creation. A selection only becomes a source relation after
// the user actually sends the message; opening the menu never creates a Link.

import type {
  AnchorService,
  ContentLink,
  LinkService,
  ResourceRegistry,
  StateTransactionService
} from '../shared/contracts/content'
import type { SelectionDraft } from '../shared/contracts/reader'
// One conversation identity for the whole app; the index module owns the constant.
import { MAIN_CONVERSATION_ID } from '../index/resources.ts'

/**
 * This build has a single AI thread, so the conversation resource uses a stable
 * source id. When real conversations land, pass the conversation id instead.
 */
export const MAIN_CONVERSATION_SOURCE_ID = MAIN_CONVERSATION_ID

export interface AsksAboutDeps {
  transactions: StateTransactionService
  anchorService: AnchorService
  linkService: LinkService
  resourceRegistry: ResourceRegistry
  now(): number
  nextId(): string
}

export async function createAsksAboutLink (
  input: { selection: SelectionDraft; messageId: string },
  deps: AsksAboutDeps
): Promise<ContentLink> {
  if (!input.selection || !input.messageId) throw new Error('缺少选区或消息标识')
  const conversation = await deps.resourceRegistry.ensureResource({
    kind: 'conversation',
    sourceId: MAIN_CONVERSATION_SOURCE_ID
  })
  const now = deps.now()
  const linkId = deps.nextId()
  const messageAnchorId = deps.nextId()
  const documentAnchorId = deps.nextId()

  return deps.transactions.run(`link:asks-about:${linkId}`, (tx) => {
    const messageAnchor = deps.anchorService.createOrReuse(
      {
        id: messageAnchorId,
        resourceId: conversation.id,
        revision: conversation.revision,
        selector: { type: 'message', messageId: input.messageId },
        snapshot: { label: '提问' }
      },
      tx
    )
    const documentAnchor = deps.anchorService.createOrReuse(
      {
        id: documentAnchorId,
        resourceId: input.selection.resourceId,
        revision: input.selection.revision,
        selector: input.selection.selector,
        ...(input.selection.kind === 'text' ? { snapshot: { text: input.selection.text } } : {})
      },
      tx
    )
    return deps.linkService.createLink(
      {
        id: linkId,
        fromAnchorId: messageAnchor.id,
        toAnchorId: documentAnchor.id,
        relation: 'asks_about',
        createdBy: 'user',
        verification: 'user_confirmed',
        createdAt: now
      },
      tx
    )
  })
}
