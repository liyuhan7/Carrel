// Course reading and annotation contracts.
// Owned by the reading/annotation module. Shapes follow
// docs/Carrel_课程阅读与标注模块统一设计.md §4 and §5.
// The unified content layer consumes this data only; it never receives DOM or PDF.js objects.

import type { ContentSelector, Rect, ShapeGeometry } from './content'

// ─── courses ───────────────────────────────────────────────────────────────

export interface Course {
  id: string
  title: string
  description?: string
  createdAt: number
  updatedAt: number
}

export interface CourseMaterial {
  courseId: string
  /** document Resource.id, never a raw fileId. */
  resourceId: string
  sectionId?: string
  order: number
  addedAt: number
}

export interface CourseSection {
  id: string
  courseId: string
  title: string
  order: number
}

// ─── reading state ─────────────────────────────────────────────────────────

export type ReaderLocation =
  | { kind: 'page'; page: number }
  | { kind: 'flow'; blockId?: string; offset?: number }

export interface ReadingState {
  resourceId: string
  /** UI context only: which course the reader was entered from. */
  courseId?: string
  location: {
    kind: 'page' | 'flow'
    page?: number
    blockId?: string
    scrollRatio?: number
  }
  zoom: number
  layout: 'single' | 'continuous'
  showAnnotations: boolean
  lastOpenedAt: number
  updatedAt: number
}

// ─── annotations ───────────────────────────────────────────────────────────

export type AnnotationKind =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'note'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'ink'

export interface AnnotationStyle {
  color: string
  opacity?: number
  strokeWidth?: number
  lineStyle?: 'solid' | 'dashed' | 'wavy'
}

export interface Annotation {
  id: string
  resourceId: string
  /** Unified Anchor.id; the authoritative position is not duplicated here. */
  anchorId: string
  kind: AnnotationKind
  /** Plain-text comment. Required (non-empty) for kind === 'note'. */
  body?: string
  style: AnnotationStyle
  createdAt: number
  updatedAt: number
}

export interface ResolvedAnnotation {
  annotation: Annotation
  status: 'ok' | 'relocated' | 'ambiguous' | 'orphaned' | 'unlocatable' | 'missing'
  page?: number
  rects?: Rect[]
  geometry?: ShapeGeometry
  /** Match score, not a calibrated probability. */
  confidence?: number
}

export interface AnnotationService {
  create(input: {
    selection: SelectionDraft
    kind: AnnotationKind
    style: AnnotationStyle
    body?: string
  }): Promise<Annotation>
  update(
    annotationId: string,
    changes: { style?: AnnotationStyle; body?: string }
  ): Promise<void>
  remove(annotationId: string): Promise<void>
  list(resourceId: string): Annotation[]
}

// ─── selection draft (single definition; maintained by this module) ────────

export type SelectionDraft =
  | {
      kind: 'text'
      resourceId: string
      revision: string
      selector: Extract<ContentSelector, { type: 'document-text' | 'document-flow' }>
      text: string
    }
  | {
      kind: 'region'
      resourceId: string
      revision: string
      selector: Extract<ContentSelector, { type: 'document-region' }>
      /** Only set when a screenshot was actually captured. */
      previewImageId?: string
    }

// ─── document adapters ─────────────────────────────────────────────────────

export interface AdapterCapabilities {
  textSelection: boolean
  regionSelection: boolean
  shapes: boolean
  comments: boolean
  textSearch: boolean
  reflow: boolean
}

export interface PageModel {
  page: number
  /** Intrinsic page size in CSS pixels before view zoom. */
  width: number
  height: number
  rotation: 0 | 90 | 180 | 270
  /** False for scanned pages without an extractable text layer. */
  hasText: boolean
  text?: string
}

export interface ReaderAdapter {
  resourceId: string
  getCapabilities(location?: ReaderLocation): AdapterCapabilities
  getRevision(): Promise<string>
  captureSelection(): SelectionDraft | null
  focusResolved(selector: ContentSelector): Promise<boolean>
}

export interface PagedAdapter extends ReaderAdapter {
  pageCount: number
  getPage(page: number): Promise<PageModel>
  captureRegion(page: number, rect: Rect): SelectionDraft
  projectToViewport(selector: ContentSelector): Promise<Rect[] | null>
}

export interface FlowAdapter extends ReaderAdapter {
  focusBlock(blockId: string): Promise<boolean>
  rangeFor(selector: ContentSelector): Range | null
}
