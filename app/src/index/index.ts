// Unified index and link module: resource identity, content units, anchors,
// relations, search and the panels other modules mount.

export {
  createContentIndex,
  type ContentIndex,
  type IndexStatus,
  type ResourceIndexEntry,
  type SearchDetail
} from './contentIndex.ts'
export { createAnchorResolver, type ResolverDeps } from './resolver.ts'
export {
  createRelationIndex,
  RELATION_LABEL,
  RESOLVE_STATUS_LABEL,
  RESOURCE_KIND_LABEL,
  type LinkDirection,
  type RelatedContentItem,
  type RelationEntry,
  type RelationIndex
} from './relations.ts'
export { createSearchService, type IndexSearchService } from './search.ts'
export {
  derivedId,
  hashString,
  normalize,
  normalizeText,
  type NormalizedText
} from './text.ts'
export {
  bestQuoteMatch,
  isReusable,
  isSelectorAllowed,
  matchQuote,
  quoteOf,
  sameSelector,
  selectorKey,
  selectorLabel,
  validateSelector,
  type QuoteMatch,
  type SelectorValidation
} from './selectors.ts'
export {
  blockIdOfUnit,
  blockUnitId,
  cleanUnitText,
  markdownBlocks,
  messageIdOfUnit,
  messageUnitId,
  messageUnits,
  noteBlockUnits,
  pageOfUnit,
  pageUnitId,
  pageUnits,
  type NoteBlockText
} from './units.ts'
export {
  CONVERSATION_TITLE,
  MAIN_CONVERSATION_ID,
  conversationResourceId,
  conversationRevision,
  documentRevision,
  noteRevision,
  planResourceSync,
  resourceIdFor,
  type ResourceSyncInput,
  type ResourceSyncPlan
} from './resources.ts'
export {
  migratedNoteAnchorId,
  migratedRefAnchorId,
  migratedRefLinkId,
  planLegacyRefMigration,
  type LegacyRefPlan,
  type LegacyRefPlanInput
} from './migrate.ts'
export { syncResourceRegistry, type ResourceSyncDeps } from './resourceSync.ts'
export { migrateLegacyRefs, type LegacyRefMigrationDeps } from './migrationRuntime.ts'
export { confirmAnchorRelocation, type RelocationDeps } from './relocation.ts'
export {
  getIndexRuntime,
  openSearchResult,
  useIndexRuntime,
  type IndexRuntime
} from './runtime.ts'
export { SearchPanel } from './SearchPanel.tsx'
export { RelatedContentPanel, SourcePanel, SourceStatusBadge } from './SourcePanel.tsx'
export { useIndexUi } from './uiState.ts'
