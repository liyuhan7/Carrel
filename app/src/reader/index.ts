// Module entry: styles plus the public surface used by the shared reader shell.

import './reader.css'

export { AnnotationOverlay, ALL_FILTERS, filterResolved } from './components/AnnotationOverlay'
export type { AnnotationFilters } from './components/AnnotationOverlay'
export { AnnotationSidebar, KIND_LABEL } from './components/AnnotationSidebar'
export { AnnotationPopover } from './components/AnnotationPopover'
export { ReaderToolbar } from './components/ReaderToolbar'
export type { ReaderTool } from './components/ReaderToolbar'
export { SelectionMenu } from './components/SelectionMenu'

export { createPdfAdapter, pagePointFromClient, pageRectFromClient } from './adapters/pdfAdapter'
export type { PdfAdapter, PdfPageHandle } from './adapters/pdfAdapter'

export { createAnnotationService } from './annotationService'
export type { AnnotationPort, ReaderAnnotationService } from './annotationService'
export { createAsksAboutLink, MAIN_CONVERSATION_SOURCE_ID } from './links'

export {
  isRenderableStatus,
  resolveAnnotation,
  resolveAnnotations,
  STATUS_HINT,
  STATUS_LABEL
} from './annotationResolve'
export type { ResolveContext } from './annotationResolve'
export { hitTestAnnotations } from './hitTest'
export {
  clampReadingState,
  clampZoom,
  createReadingState,
  legacyReadingState,
  patchReadingState,
  readingStatePage
} from './readingState'
export type { ReadingStatePatch } from './readingState'
export {
  isLegacyAnnotation,
  isMigratedAnnotation,
  LEGACY_UNKNOWN_REVISION,
  migrateStoredAnnotations,
  planAnnotationMigration
} from './migrate'
export type { LegacyAnnotationRecord, LegacyFileMeta, MigrationOutcome } from './migrate'
export {
  clamp01,
  geometryBounds,
  pointFromClient,
  rectFromClient,
  rectsFromClient,
  unionRects
} from './geometry'
export type { Rotation } from './geometry'
