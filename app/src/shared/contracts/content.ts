// Unified content model: identity, content units, anchors, links, search, navigation.
// Owned by the unified index/link module. Other modules import these types only.
// Shapes follow docs/Carrel_统一索引与链接模型设计.md §3–§7.

export type ResourceKind = 'document' | 'conversation' | 'note'

export interface Resource {
  id: string
  kind: ResourceKind
  /** Existing primary key: FileRec.id, conversationId or noteId. */
  sourceId: string
  title: string
  /** Content revision: file hash for documents, monotonic counter otherwise. */
  revision: string
  createdAt: number
  updatedAt: number
  availability: 'available' | 'missing' | 'deleted'
}

export interface ResourceRef {
  kind: ResourceKind
  sourceId: string
}

export interface ResourceRegistry {
  ensureResource(ref: ResourceRef): Promise<Resource>
  getResource(resourceId: string): Resource | undefined
}

export type ContentUnitKind = 'page' | 'message' | 'block'

export interface ContentUnit {
  id: string
  resourceId: string
  kind: ContentUnitKind
  parentId?: string
  order: number
  revision: string
  text: string
}

// ─── selectors ─────────────────────────────────────────────────────────────

export interface TextQuote {
  exact: string
  prefix?: string
  suffix?: string
}

/** [x, y, width, height], normalised to the rotated page box (0..1). */
export type Rect = [number, number, number, number]
export type Point = [number, number]

export type ShapeGeometry =
  | { type: 'rect' | 'ellipse'; rect: Rect }
  | { type: 'arrow'; from: Point; to: Point }
  | { type: 'ink'; points: Point[] }

export type ContentSelector =
  | { type: 'resource' }
  | {
      type: 'document-text'
      page: number // 1-based
      quote: TextQuote
      rects?: Rect[]
      rotation?: 0 | 90 | 180 | 270
    }
  | {
      type: 'document-region'
      page: number
      geometry: ShapeGeometry
      rotation?: 0 | 90 | 180 | 270
    }
  | {
      type: 'document-flow'
      blockId?: string
      quote: TextQuote
      start?: number
      end?: number
    }
  | {
      type: 'message'
      messageId: string
      quote?: TextQuote
      start?: number
      end?: number
    }
  | {
      type: 'note-block'
      blockId: string
      quote?: TextQuote
      start?: number
      end?: number
    }

// ─── anchors ───────────────────────────────────────────────────────────────

export interface Anchor {
  id: string
  resourceId: string
  /** Shortcut hint for the current revision; never the only locator. */
  unitId?: string
  origin: {
    revision: string
    selector: ContentSelector
  }
  accepted: {
    revision: string
    selector: ContentSelector
  }
  snapshot?: {
    text?: string
    prefix?: string
    suffix?: string
    label?: string
  }
  createdAt: number
  updatedAt: number
}

export interface AnchorCreateInput {
  /** Caller pre-allocates; reuse may return an existing Anchor.id instead. */
  id: string
  resourceId: string
  revision: string
  selector: ContentSelector
  snapshot?: Anchor['snapshot']
}

// ─── links ─────────────────────────────────────────────────────────────────

export type LinkRelation =
  | 'asks_about'
  | 'quotes'
  | 'cites'
  | 'references'
  | 'derived_from'
  | 'related_to'

export type NoteSourceRelation = Extract<
  LinkRelation,
  'quotes' | 'references' | 'derived_from'
>

export interface ContentLink {
  id: string
  fromAnchorId: string
  toAnchorId: string
  relation: LinkRelation
  createdBy: 'user' | 'system'
  verification: 'user_confirmed' | 'system_verified' | 'unverified'
  createdAt: number
  metadata?: { note?: string }
}

export interface LinkQuery {
  anchorId?: string
  resourceId?: string
  direction?: 'outgoing' | 'incoming' | 'both'
}

// ─── resolve ───────────────────────────────────────────────────────────────

export type ResolveStatus =
  | 'ok'
  | 'relocated'
  | 'ambiguous'
  | 'orphaned'
  | 'unlocatable'
  | 'missing'

export interface ResolveResult {
  anchorId: string
  status: ResolveStatus
  selector?: ContentSelector
  candidates?: ContentSelector[]
}

export interface AnchorResolver {
  supports(resource: Resource, selector: ContentSelector): boolean
  resolve(anchor: Anchor): Promise<ResolveResult>
}

// ─── search ────────────────────────────────────────────────────────────────

export interface IndexRecord {
  unitId: string
  resourceId: string
  resourceKind: ResourceKind
  title: string
  text: string
  revision: string
  indexedAt: number
}

export interface SearchQuery {
  text: string
  resourceKinds?: ResourceKind[]
  resourceIds?: string[]
  limit?: number
}

export interface SearchResult {
  unitId: string
  resourceId: string
  score: number
  snippet: string
  /** Ephemeral locator, not a persisted Anchor. */
  locator: ContentSelector
}

export interface SearchService {
  search(query: SearchQuery): Promise<SearchResult[]>
}

// ─── transactions and services ─────────────────────────────────────────────

/** Shared staging context handed to services by the data layer. Not a DB handle. */
export interface StateTransaction {
  readonly operationId: string
}

export interface StateTransactionService {
  run<T>(
    operationId: string,
    prepare: (tx: StateTransaction) => T
  ): Promise<T>
}

export interface AnchorService {
  createOrReuse(input: AnchorCreateInput, tx: StateTransaction): Anchor
  getAnchor(anchorId: string, tx?: StateTransaction): Anchor | undefined
  removeIfUnused(anchorId: string, tx: StateTransaction): void
}

export interface LinkService {
  createLink(input: ContentLink, tx: StateTransaction): ContentLink
  removeLink(linkId: string, tx: StateTransaction): void
  getLink(linkId: string, tx?: StateTransaction): ContentLink | undefined
  getLinks(query: LinkQuery, tx?: StateTransaction): ContentLink[]
}

export interface NavigationService {
  navigateToAnchor(anchorId: string): Promise<void>
  navigateToLink(linkId: string): Promise<void>
  navigateToSearchResult(result: SearchResult): Promise<void>
}

/** Published only after a complete commit; notification, not authoritative state. */
export type ContentChangeEvent =
  | { type: 'ResourceChanged'; resourceId: string; revision: string }
  | {
      type: 'ContentUnitChanged'
      resourceId: string
      revision: string
      upsertedUnitIds: string[]
      removedUnitIds: string[]
    }
  | { type: 'AnchorChanged'; anchorIds: string[] }
  | { type: 'LinkChanged'; linkIds: string[] }

/** In-app address schemes. Local absolute paths never appear in them. */
export const ANCHOR_URI_PREFIX = 'carrel://anchor/'
export const LINK_URI_PREFIX = 'csref:'

export const anchorUri = (anchorId: string): string => `${ANCHOR_URI_PREFIX}${anchorId}`
export const linkUri = (linkId: string): string => `${LINK_URI_PREFIX}${linkId}`

export function parseAnchorUri(uri: string): string | null {
  return uri.startsWith(ANCHOR_URI_PREFIX) ? uri.slice(ANCHOR_URI_PREFIX.length) : null
}

export function parseLinkUri(uri: string): string | null {
  return uri.startsWith(LINK_URI_PREFIX) ? uri.slice(LINK_URI_PREFIX.length) : null
}
