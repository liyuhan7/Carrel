// Shared content services provided by the integration layer and consumed by
// the reading, note and unified-index modules.

export type { SharedDataPort, SharedSlices } from './port'
export type { StagedTransaction } from './transactions'
export type { NavigationHost } from './navigation'
export { draftOf, createTransactionService } from './transactions'
export { createAnchorService } from './anchors'
export { createLinkService } from './links'
export { createResourceRegistry } from './resources'
export { createNavigationService } from './navigation'

// >>> integration:unified-content-index
// Unified index/link services implemented in src/index/.
export { createAnchorResolver, type ResolverDeps } from '../../index/resolver.ts'
export {
  createContentIndex,
  type ContentIndex,
  type IndexStatus,
  type ResourceIndexEntry,
  type SearchDetail
} from '../../index/contentIndex.ts'
export {
  createRelationIndex,
  type LinkDirection,
  type RelatedContentItem,
  type RelationEntry,
  type RelationIndex
} from '../../index/relations.ts'
export { createSearchService, type IndexSearchService } from '../../index/search.ts'
// <<< integration:unified-content-index
