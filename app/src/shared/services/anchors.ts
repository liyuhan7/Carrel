// Anchor creation, reuse and lookup. Positions live here; Annotations and Links reference them.

import type {
  Anchor,
  AnchorCreateInput,
  AnchorService,
  ContentSelector,
  StateTransaction
} from '../contracts/content'
import type { SharedDataPort } from './port'
import { draftOf } from './transactions'

/** Structural key for selector equality; numeric noise below 1e-4 is ignored. */
function selectorKey(selector: ContentSelector): string {
  return JSON.stringify(selector, (_key, value) =>
    typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value
  )
}

function samePosition(a: Anchor, input: AnchorCreateInput): boolean {
  return (
    a.resourceId === input.resourceId &&
    a.accepted.revision === input.revision &&
    selectorKey(a.accepted.selector) === selectorKey(input.selector)
  )
}

export function createAnchorService(port: SharedDataPort): AnchorService {
  return {
    createOrReuse(input, tx) {
      const draft = draftOf(tx, port)
      const existing = Object.values(draft.anchors).find((anchor) => samePosition(anchor, input))
      if (existing) return existing

      const now = port.now()
      const anchor: Anchor = {
        id: input.id,
        resourceId: input.resourceId,
        origin: { revision: input.revision, selector: input.selector },
        accepted: { revision: input.revision, selector: input.selector },
        snapshot: input.snapshot,
        createdAt: now,
        updatedAt: now
      }
      draft.anchors[anchor.id] = anchor
      return anchor
    },

    getAnchor(anchorId, tx) {
      return draftOf(tx, port).anchors[anchorId]
    },

    removeIfUnused(anchorId, tx) {
      const draft = draftOf(tx, port)
      if (!draft.anchors[anchorId]) return
      if (port.isAnchorUsed(anchorId)) return
      const linked = Object.values(draft.links).some(
        (link) => link.fromAnchorId === anchorId || link.toAnchorId === anchorId
      )
      if (linked) return
      delete draft.anchors[anchorId]
    }
  }
}
