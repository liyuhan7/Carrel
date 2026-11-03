// Explicit content relations. Links only exist when the user (or a verified system
// step) created them; similarity never creates one automatically.

import type { ContentLink, LinkQuery, LinkService, StateTransaction } from '../contracts/content'
import type { SharedDataPort } from './port'
import { draftOf } from './transactions'

export function createLinkService(port: SharedDataPort): LinkService {
  return {
    createLink(input: ContentLink, tx: StateTransaction): ContentLink {
      const draft = draftOf(tx, port)
      // Both endpoints must exist in committed state or in this same transaction.
      if (!draft.anchors[input.fromAnchorId]) {
        throw new Error(`link source anchor not found: ${input.fromAnchorId}`)
      }
      if (!draft.anchors[input.toAnchorId]) {
        throw new Error(`link target anchor not found: ${input.toAnchorId}`)
      }
      const link: ContentLink = { ...input }
      draft.links[link.id] = link
      return link
    },

    removeLink(linkId, tx) {
      const draft = draftOf(tx, port)
      delete draft.links[linkId]
    },

    getLink(linkId, tx) {
      return draftOf(tx, port).links[linkId]
    },

    getLinks(query: LinkQuery, tx) {
      const draft = draftOf(tx, port)
      const direction = query.direction ?? 'both'
      if (!query.anchorId && !query.resourceId) {
        throw new Error('getLinks requires anchorId or resourceId')
      }
      // resourceId matches anchors that belong to that resource.
      const resourceAnchorIds = query.resourceId
        ? new Set(
            Object.values(draft.anchors)
              .filter((anchor) => anchor.resourceId === query.resourceId)
              .map((anchor) => anchor.id)
          )
        : undefined

      return Object.values(draft.links).filter((link) => {
        if (query.anchorId) {
          const matchesSource = link.fromAnchorId === query.anchorId
          const matchesTarget = link.toAnchorId === query.anchorId
          if (direction === 'outgoing' && !matchesSource) return false
          if (direction === 'incoming' && !matchesTarget) return false
          if (direction === 'both' && !matchesSource && !matchesTarget) return false
        }
        if (resourceAnchorIds) {
          const touches =
            resourceAnchorIds.has(link.fromAnchorId) || resourceAnchorIds.has(link.toAnchorId)
          if (!touches) return false
        }
        return true
      })
    }
  }
}
