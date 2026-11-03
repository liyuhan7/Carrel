// RelationIndex: derived lookup structures over explicit ContentLinks.
// Links are never inferred from text similarity and never made transitive:
// a chain A -> B -> C does not create A -> C.

import type {
  ContentLink,
  LinkRelation,
  ResourceKind,
  ResolveStatus
} from '../shared/contracts/content'
import type { SharedSlices } from '../shared/services/port'

export type LinkDirection = 'outgoing' | 'incoming'

export interface RelationEntry {
  link: ContentLink
  /** Direction relative to the anchor the query started from. */
  direction: LinkDirection
  /** Anchor on the queried side. */
  anchorId: string
  otherAnchorId: string
  otherResourceId: string
  otherKind?: ResourceKind
  otherTitle?: string
  otherAvailability?: 'available' | 'missing' | 'deleted'
  relation: LinkRelation
  /** Saved excerpt of the other side; survives a missing source. */
  snapshotText?: string
  snapshotLabel?: string
}

export interface RelatedContentItem extends RelationEntry {
  /** Anchor of the queried resource that participates in the link. */
  resourceAnchorId: string
}

export interface RelationIndex {
  linksFrom(anchorId: string): ContentLink[]
  linksTo(anchorId: string): ContentLink[]
  linksForAnchor(anchorId: string, direction?: LinkDirection | 'both'): ContentLink[]
  anchorIdsForResource(resourceId: string): string[]
  linksForResource(resourceId: string): ContentLink[]
  entriesForAnchor(anchorId: string): RelationEntry[]
  relatedContent(resourceId: string): RelatedContentItem[]
  /** Forces a rebuild; not needed when slices are replaced immutably. */
  invalidate(): void
}

const KIND_ORDER: Record<ResourceKind, number> = { document: 0, conversation: 1, note: 2 }

export function createRelationIndex(read: () => SharedSlices): RelationIndex {
  let cachedLinks: SharedSlices['links'] | null = null
  let cachedAnchors: SharedSlices['anchors'] | null = null
  const byFrom = new Map<string, ContentLink[]>()
  const byTo = new Map<string, ContentLink[]>()
  const anchorsByResource = new Map<string, string[]>()
  const linksByResource = new Map<string, ContentLink[]>()

  const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }

  const ensure = (): SharedSlices => {
    const slices = read()
    if (slices.links === cachedLinks && slices.anchors === cachedAnchors) return slices
    cachedLinks = slices.links
    cachedAnchors = slices.anchors
    byFrom.clear()
    byTo.clear()
    anchorsByResource.clear()
    linksByResource.clear()

    for (const anchor of Object.values(slices.anchors)) {
      push(anchorsByResource, anchor.resourceId, anchor.id)
    }
    for (const link of Object.values(slices.links)) {
      push(byFrom, link.fromAnchorId, link)
      push(byTo, link.toAnchorId, link)
      const resourceIds = new Set<string>()
      const from = slices.anchors[link.fromAnchorId]
      const to = slices.anchors[link.toAnchorId]
      if (from) resourceIds.add(from.resourceId)
      if (to) resourceIds.add(to.resourceId)
      for (const resourceId of resourceIds) push(linksByResource, resourceId, link)
    }
    return slices
  }

  const linksForAnchor = (anchorId: string, direction: LinkDirection | 'both' = 'both'): ContentLink[] => {
    ensure()
    const outgoing = direction === 'incoming' ? [] : byFrom.get(anchorId) ?? []
    const incoming = direction === 'outgoing' ? [] : byTo.get(anchorId) ?? []
    // A self-link appears in both lists; keep one copy.
    const seen = new Set<string>()
    return [...outgoing, ...incoming].filter((link) => {
      if (seen.has(link.id)) return false
      seen.add(link.id)
      return true
    })
  }

  const entryFor = (link: ContentLink, anchorId: string, slices: SharedSlices): RelationEntry => {
    const outgoing = link.fromAnchorId === anchorId
    const otherAnchorId = outgoing ? link.toAnchorId : link.fromAnchorId
    const otherAnchor = slices.anchors[otherAnchorId]
    const otherResource = otherAnchor ? slices.resources[otherAnchor.resourceId] : undefined
    return {
      link,
      direction: outgoing ? 'outgoing' : 'incoming',
      anchorId,
      otherAnchorId,
      otherResourceId: otherAnchor?.resourceId ?? '',
      otherKind: otherResource?.kind,
      otherTitle: otherResource?.title,
      otherAvailability: otherResource?.availability,
      relation: link.relation,
      snapshotText: otherAnchor?.snapshot?.text,
      snapshotLabel: otherAnchor?.snapshot?.label
    }
  }

  return {
    linksFrom(anchorId) {
      ensure()
      return [...(byFrom.get(anchorId) ?? [])]
    },

    linksTo(anchorId) {
      ensure()
      return [...(byTo.get(anchorId) ?? [])]
    },

    linksForAnchor,

    anchorIdsForResource(resourceId) {
      ensure()
      return [...(anchorsByResource.get(resourceId) ?? [])]
    },

    linksForResource(resourceId) {
      ensure()
      return [...(linksByResource.get(resourceId) ?? [])]
    },

    entriesForAnchor(anchorId) {
      const slices = ensure()
      return linksForAnchor(anchorId).map((link) => entryFor(link, anchorId, slices))
    },

    relatedContent(resourceId) {
      const slices = ensure()
      const items: RelatedContentItem[] = []
      const seen = new Set<string>()
      for (const anchorId of anchorsByResource.get(resourceId) ?? []) {
        for (const link of linksForAnchor(anchorId)) {
          if (seen.has(link.id)) continue
          seen.add(link.id)
          items.push({ ...entryFor(link, anchorId, slices), resourceAnchorId: anchorId })
        }
      }
      return items.sort((a, b) => {
        const kindA = a.otherKind ? KIND_ORDER[a.otherKind] : 9
        const kindB = b.otherKind ? KIND_ORDER[b.otherKind] : 9
        if (kindA !== kindB) return kindA - kindB
        return (a.otherTitle ?? '').localeCompare(b.otherTitle ?? '')
      })
    },

    invalidate() {
      cachedLinks = null
      cachedAnchors = null
    }
  }
}

/** UI grouping key for "related content" lists. */
export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  document: '资料',
  conversation: '会话',
  note: '笔记'
}

/** Resolve status wording. Never a blanket "已验证". */
export const RESOLVE_STATUS_LABEL: Record<ResolveStatus, string> = {
  ok: '已匹配原文',
  relocated: '已重定位',
  ambiguous: '需确认',
  orphaned: '无法定位',
  unlocatable: '无法定位',
  missing: '来源缺失'
}

export const RELATION_LABEL: Record<LinkRelation, string> = {
  asks_about: '提问于',
  quotes: '直接引用',
  cites: '引用',
  references: '参考来源',
  derived_from: '整理自',
  related_to: '相关'
}
