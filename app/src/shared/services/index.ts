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
