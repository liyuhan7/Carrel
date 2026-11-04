import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { textCache, useStore } from '../store'
import type { Rect } from '../types'
import { PdfViewer, type PdfPointPayload, type PdfRegionPayload, type PdfSelectPayload, type PdfViewState } from './PdfViewer'
import { DocViewer } from './DocViewer'
import { TypeBadge } from './TypeBadge'
import { formatBytes } from '../lib/format'
import type { AnnotationStyle, ResolvedAnnotation, SelectionDraft } from '../shared/contracts/reader'
// >>> integration:course-reading-annotation
// The reader shell now uses the annotation module for tools, overlay, sidebar,
// selection menu, resolution and per-resource reading state.
import {
  ALL_FILTERS,
  AnnotationOverlay,
  AnnotationPopover,
  AnnotationSidebar,
  ReaderToolbar,
  SelectionMenu,
  clamp01,
  clampReadingState,
  createPdfAdapter,
  filterResolved,
  hitTestAnnotations,
  resolveAnnotations,
  type AnnotationFilters,
  type PdfAdapter,
  type ReaderTool,
  type Rotation
} from '../reader'
// <<< integration:course-reading-annotation

type AnnotationDraft = SelectionDraft

interface SelectionPopup {
  draft: AnnotationDraft
  text: string
  x: number
  y: number
  note: boolean
}

function styleFor (kind: string, color: string): AnnotationStyle {
  return {
    color,
    opacity: kind === 'highlight' ? 0.45 : 1,
    strokeWidth: 2
  }
}

export function ReaderPane ({ collapsed, onExpand, onCollapse }: {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}) {
  const files = useStore((s) => s.files)
  const workspace = useStore((s) => s.workspace)
  const annotations = useStore((s) => s.annotations)
  const anchors = useStore((s) => s.anchors)
  const resources = useStore((s) => s.resources)
  const links = useStore((s) => s.links)
  const linkService = useStore((s) => s.linkService)
  const navigation = useStore((s) => s.navigation)
  const setPage = useStore((s) => s.setPage)
  const closeTab = useStore((s) => s.closeTab)
  const openFile = useStore((s) => s.openFile)
  const importDialog = useStore((s) => s.importDialog)
  const setReaderPanel = useStore((s) => s.setReaderPanel)
  const setZoom = useStore((s) => s.setZoom)
  const removeAnnotation = useStore((s) => s.removeAnnotation)
  const updateAnnotation = useStore((s) => s.updateAnnotation)
  const createAnnotation = useStore((s) => s.createAnnotation)
  const undoAnnotation = useStore((s) => s.undoAnnotation)
  const ensureFileResource = useStore((s) => s.ensureFileResource)
  const setReadingState = useStore((s) => s.setReadingState)
  const focusOn = useStore((s) => s.focusOn)
  const focusQuote = useStore((s) => s.focusQuote)
  const setSelection = useStore((s) => s.setSelection)
  const insertSelectionToNote = useStore((s) => s.insertSelectionToNote)
  const sendQuestion = useStore((s) => s.sendQuestion)
  const focusComposer = useStore((s) => s.focusComposer)
  const notify = useStore((s) => s.notify)
  const setView = useStore((s) => s.setView)

  const [popup, setPopup] = useState<SelectionPopup | null>(null)
  const [selected, setSelected] = useState<{ items: ResolvedAnnotation[]; x: number; y: number } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchAt, setMatchAt] = useState(0)
  const [draft, setDraft] = useState('1')
  // >>> integration:course-reading-annotation
  const [resourceId, setResourceId] = useState<string | null>(null)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [pageBox, setPageBox] = useState({ width: 0, height: 0 })
  const [tool, setTool] = useState<ReaderTool>('select')
  const [panMode, setPanMode] = useState(false)
  const [color, setColor] = useState('#d9c48f')
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [filters, setFilters] = useState<AnnotationFilters>(ALL_FILTERS)
  const [projected, setProjected] = useState<Record<string, Rect[]>>({})
  const [viewReadyTick, setViewReadyTick] = useState(0)
  const [scrollRestore, setScrollRestore] = useState<{ ratio: number; nonce: number } | null>(null)
  // <<< integration:course-reading-annotation

  const adapterRef = useRef<PdfAdapter | null>(null)
  const viewStateRef = useRef<PdfViewState | null>(null)
  const scrollRatioRef = useRef<number | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const file = files.find((item) => item.id === workspace.activeTab)
  const page = file ? workspace.pages[file.id] ?? 1 : 1
  const pageCount = file?.pageCount || 1
  const zoom = workspace.zoom

  // >>> integration:course-reading-annotation
  const adapter = useMemo<PdfAdapter | null>(() => {
    if (!file || file.kind !== 'pdf' || !resourceId) return null
    return createPdfAdapter({
      resourceId,
      fileId: file.id,
      revision: () => file.hash,
      pageText: (target) => textCache.get(file.id)?.[target - 1],
      pageCount: () => file.pageCount || 1,
      goToPage: (target) => setPage(file.id, target),
      flashQuote: (target, quote) => focusOn(file.id, target, quote)
    })
  }, [file?.id, file?.hash, file?.pageCount, resourceId, setPage, focusOn])

  useEffect(() => {
    adapterRef.current = adapter
    const view = viewStateRef.current
    if (adapter && view?.ready && view.element) {
      adapter.attach({ page: view.page, rotation: view.rotation, element: view.element })
    }
  }, [adapter])

  useEffect(() => {
    setDraft(String(page))
  }, [page])

  useEffect(() => {
    if (!popup) return
    // pointerdown, not mousedown: the viewer cancels pointerdown to own text
    // selection, which suppresses the compatibility mousedown event.
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.selection-pop')) setPopup(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [popup])

  useEffect(() => {
    if (!selected) return
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.anno-popover') || target.closest('.anno-note-marker')) return
      setSelected(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [selected])

  // Restore this document's reading state once its resource identity exists.
  useEffect(() => {
    setPopup(null)
    setSelected(null)
    setProjected({})
    setResourceId(null)
    if (!file) return
    let cancelled = false
    ;(async () => {
      const id = await ensureFileResource(file.id)
      if (cancelled || !id) return
      setResourceId(id)
      const saved = useStore.getState().readingStates?.[id]
      if (!saved) {
        setShowAnnotations(true)
        return
      }
      const clamped = clampReadingState(saved, file.pageCount || 1)
      setShowAnnotations(clamped.showAnnotations)
      if (clamped.location.page && clamped.location.page !== page) setPage(file.id, clamped.location.page)
      if (clamped.zoom !== zoom) setZoom(clamped.zoom)
      if (clamped.location.scrollRatio !== undefined) {
        // Applied once by the viewer as soon as the page stack is laid out.
        setScrollRestore({ ratio: clamped.location.scrollRatio, nonce: Date.now() })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file?.id])

  // The pending scroll restore belongs to opening the document; leaving the
  // reading view drops it so a remount does not jump back to the opening spot.
  useEffect(() => {
    if (workspace.readerPanel !== 'doc') setScrollRestore(null)
  }, [workspace.readerPanel])

  // Persist page, zoom and annotation visibility per resource. The reader is
  // continuous: pages are stacked and scrolling turns them.
  useEffect(() => {
    if (!resourceId) return
    setReadingState(resourceId, {
      location: { kind: 'page', page },
      zoom,
      layout: 'continuous',
      showAnnotations
    })
  }, [resourceId, page, zoom, showAnnotations, setReadingState])

  const resolved = useMemo<ResolvedAnnotation[]>(() => {
    if (!file || !resourceId) return []
    const resource = resources[resourceId]
    return resolveAnnotations(
      annotations.filter((annotation) => annotation.resourceId === resourceId),
      {
        revision: file.hash,
        pageCount: file.pageCount || 1,
        pageText: (target) => textCache.get(file.id)?.[target - 1],
        rotationFor: (target) => (target === page ? rotation : undefined),
        anchorFor: (anchorId) => anchors[anchorId],
        resourceAvailable: !file.missing && resource?.availability !== 'missing' && resource?.availability !== 'deleted'
      }
    )
  }, [annotations, anchors, resources, resourceId, file?.hash, file?.missing, file?.pageCount, page, rotation])

  const displayResolved = useMemo(
    () => resolved.map((item) => {
      const rects = projected[item.annotation.id]
      return rects ? { ...item, rects } : item
    }),
    [resolved, projected]
  )
  const filteredResolved = useMemo(() => filterResolved(displayResolved, filters), [displayResolved, filters])

  // Relocated text positions are projected to rectangles only for the visible page.
  useEffect(() => {
    const current = adapterRef.current
    if (!current) return
    let cancelled = false
    const targets = resolved.filter((item) => item.status === 'relocated' && item.page === page && !item.rects)
    if (!targets.length) return
    void (async () => {
      const next: Record<string, Rect[]> = {}
      for (const item of targets) {
        const anchor = anchors[item.annotation.anchorId]
        if (!anchor) continue
        const rects = await current.projectToViewport(anchor.accepted.selector)
        if (rects?.length) next[item.annotation.id] = rects
      }
      if (!cancelled && Object.keys(next).length) setProjected((previous) => ({ ...previous, ...next }))
    })()
    return () => {
      cancelled = true
    }
  }, [resolved, anchors, page, rotation, adapter, pageBox.width, pageBox.height, viewReadyTick])

  const linksForResource = useMemo(() => {
    if (!resourceId) return []
    try {
      return linkService.getLinks({ resourceId })
    } catch {
      return []
    }
  }, [linkService, resourceId, links, anchors])

  const canUndo = resourceId ? useStore.getState().annotationService.canUndo(resourceId) : false
  const undoLabel = resourceId ? useStore.getState().annotationService.undoLabel(resourceId) : null

  const matches = useMemo(() => {
    if (!file || !query.trim()) return []
    const pages = textCache.get(file.id) || []
    const keyword = query.trim()
    const hits: number[] = []
    pages.forEach((text, index) => {
      if (text.includes(keyword)) hits.push(index + 1)
    })
    return hits
  }, [file?.id, file?.hash, query])

  const commitPage = () => {
    if (!file) return
    const next = Number(draft)
    if (Number.isFinite(next)) setPage(file.id, next)
    else setDraft(String(page))
  }

  const goMatch = (direction: number) => {
    if (!file || matches.length === 0) return
    const next = (matchAt + direction + matches.length) % matches.length
    setMatchAt(next)
    setPage(file.id, matches[next])
  }

  const handleViewState = useCallback((state: PdfViewState) => {
    viewStateRef.current = state
    setRotation(state.rotation)
    setPageBox((previous) =>
      previous.width === state.width && previous.height === state.height
        ? previous
        : { width: state.width, height: state.height }
    )
    const current = adapterRef.current
    if (current) {
      current.attach(state.ready && state.element ? { page: state.page, rotation: state.rotation, element: state.element } : null)
    }
    // Signal that the page box, text layer and adapter handle are all ready.
    if (state.ready) setViewReadyTick((tick) => tick + 1)
  }, [])

  const handleScrollRatio = useCallback((ratio: number) => {
    scrollRatioRef.current = ratio
    clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      const id = resourceId
      if (!id) return
      setReadingState(id, { location: { scrollRatio: ratio } })
    }, 500)
  }, [resourceId, setReadingState])

  const fallbackDraft = (payload: PdfSelectPayload): SelectionDraft | null => {
    if (!file || !resourceId) return null
    return {
      kind: 'text',
      resourceId,
      revision: file.hash,
      selector: {
        type: 'document-text',
        page,
        quote: { exact: payload.text },
        rects: payload.rects,
        rotation
      },
      text: payload.text
    }
  }

  const commitCreate = async (draftInput: SelectionDraft, kind: ReaderTool, body?: string) => {
    if (kind === 'select') return
    const annotation = await createAnnotation(draftInput, kind, styleFor(kind, color), body)
    if (annotation) {
      setPopup(null)
      setSelected(null)
    }
    return annotation
  }

  const handleSelect = (payload: PdfSelectPayload) => {
    const draftInput = adapterRef.current?.captureSelection() ?? fallbackDraft(payload)
    if (!draftInput) return
    if (tool === 'highlight' || tool === 'underline' || tool === 'strikethrough') {
      void commitCreate(draftInput, tool)
      return
    }
    setPopup({ draft: draftInput, text: payload.text, x: payload.x, y: payload.y, note: tool === 'note' })
  }

  const handleAnnotationClick = (payload: PdfPointPayload) => {
    if (!file || !resourceId) return
    const hits = hitTestAnnotations(
      payload.point,
      displayResolved.filter((item) => item.page === payload.page)
    )
    if (hits.length) {
      setPopup(null)
      setSelected({ items: hits, x: payload.x, y: payload.y })
      return
    }
    setSelected(null)
    if (tool === 'note') {
      const rect: Rect = [
        clamp01(payload.point[0] - 0.012),
        clamp01(payload.point[1] - 0.012),
        0.024,
        0.024
      ]
      const draftInput = adapterRef.current?.captureRegion(payload.page, rect)
      if (draftInput) setPopup({ draft: draftInput, text: '页面位置批注', x: payload.x, y: payload.y, note: true })
    }
  }

  const handleRegion = (payload: PdfRegionPayload) => {
    if (!adapterRef.current || !resourceId) return
    const selection: SelectionDraft = {
      kind: 'region',
      resourceId,
      revision: file?.hash ?? '0',
      selector: {
        type: 'document-region',
        page: payload.page,
        geometry: payload.geometry,
        rotation: payload.rotation
      }
    }
    const kind = payload.geometry.type
    void commitCreate(selection, kind)
  }

  const undo = useCallback(async () => {
    if (!resourceId) return
    try {
      const done = await undoAnnotation(resourceId)
      if (done) notify('已撤销上一步标注操作')
    } catch (error) {
      notify((error as Error).message || '撤销失败', 'error')
    }
  }, [resourceId, undoAnnotation, notify])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.shiftKey || event.key.toLowerCase() !== 'z' || !resourceId) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [resourceId, undo])

  const jumpTo = (item: ResolvedAnnotation) => {
    if (!file) return
    const target = item.page ?? 1
    setPage(file.id, target)
    setReaderPanel('doc')
    setSelected(null)
    const anchor = anchors[item.annotation.anchorId]
    if (anchor?.accepted.selector.type === 'document-text') {
      focusOn(file.id, target, anchor.accepted.selector.quote.exact)
    }
  }

  const askAbout = (item: ResolvedAnnotation) => {
    if (!file) return
    const anchor = anchors[item.annotation.anchorId]
    const selector = anchor?.accepted.selector
    if (!anchor || selector?.type !== 'document-text') {
      notify('区域标注暂不支持直接向 AI 提问，可先选中原文再提问', 'error')
      return
    }
    const draftInput: SelectionDraft = {
      kind: 'text',
      resourceId: item.annotation.resourceId,
      revision: anchor.accepted.revision,
      selector,
      text: selector.quote.exact
    }
    setSelection({
      fileId: file.id,
      page: item.page ?? selector.page,
      text: selector.quote.exact,
      draft: draftInput
    })
    setPopup(null)
    setSelected(null)
    setReaderPanel('doc')
    focusComposer()
  }

  const addToNote = (item: ResolvedAnnotation) => {
    if (!file) return
    const anchor = anchors[item.annotation.anchorId]
    const selector = anchor?.accepted.selector
    const text = selector?.type === 'document-text' ? selector.quote.exact : item.annotation.body
    if (!text) {
      notify('这条标注没有可摘录的文字', 'error')
      return
    }
    setSelection({ fileId: file.id, page: item.page ?? 1, text })
    insertSelectionToNote()
    setPopup(null)
    setSelected(null)
  }

  const removeItem = async (annotationId: string) => {
    await removeAnnotation(annotationId)
    setSelected(null)
  }

  const quoteOf = (item: ResolvedAnnotation): string => {
    const anchor = anchors[item.annotation.anchorId]
    const selector = anchor?.accepted.selector
    if (selector?.type === 'document-text') return selector.quote.exact
    return anchor?.snapshot?.text ?? item.annotation.body ?? ''
  }
  // <<< integration:course-reading-annotation

  if (collapsed) {
    return (
      <button type="button" className="pane-rail" onClick={onExpand} title="展开课件阅读">
        <span>课件阅读</span>
      </button>
    )
  }

  // >>> integration:course-reading-annotation
  const overlay = (view: { page: number; rotation: Rotation; width: number; height: number }) => (
    <AnnotationOverlay
      resolved={filteredResolved}
      page={view.page}
      pageWidth={view.width}
      pageHeight={view.height}
      visible={showAnnotations}
      filters={ALL_FILTERS}
      selectedId={selected?.items[0]?.annotation.id ?? null}
      onSelect={(annotationId) => {
        const item = displayResolved.find((candidate) => candidate.annotation.id === annotationId)
        if (item) setSelected({ items: [item], x: window.innerWidth / 2, y: window.innerHeight / 2 })
      }}
    />
  )

  const pageAnnotations = annotations.filter((annotation) => annotation.resourceId === resourceId)
  // <<< integration:course-reading-annotation

  return (
    <section className="pane reader-pane">
      <div className="pane-head reader-head">
        <div className="tabs" role="tablist" aria-label="打开的资料">
          {workspace.tabs.map((id) => {
            const tabFile = files.find((item) => item.id === id)
            if (!tabFile) return null
            const active = id === workspace.activeTab
            return (
              <div
                key={id}
                className={`tab${active ? ' is-active' : ''}`}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                title={tabFile.name}
                onClick={() => void openFile(id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void openFile(id)
                }}
              >
                <TypeBadge kind={tabFile.kind} ext={tabFile.ext} />
                <span className="tab-name">{tabFile.name}</span>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`关闭 ${tabFile.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(id)
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
          <button type="button" className="tab-add" title="导入资料" onClick={() => void importDialog()}>
            ＋
          </button>
        </div>
        <button type="button" className="icon-btn" title="收起课件区" onClick={onCollapse}>
          ‹
        </button>
      </div>

      {!file ? (
        <div className="doc-empty">
          <h2>打开一份资料</h2>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void importDialog()}>
              导入资料
            </button>
            <button type="button" className="btn" onClick={() => setView('library')}>
              打开资料库
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="reader-tools">
            <div className="tool-group">
              <button type="button" className="tool" title="上一页" disabled={page <= 1} onClick={() => setPage(file.id, page - 1)}>
                ‹
              </button>
              <label className="page-input">
                <input
                  value={draft}
                  aria-label="页码"
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitPage}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitPage()
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span>/ {pageCount}</span>
              </label>
              <button type="button" className="tool" title="下一页" disabled={page >= pageCount} onClick={() => setPage(file.id, page + 1)}>
                ›
              </button>
            </div>

            <span className="tool-sep" />

            <div className="tool-group">
              <button type="button" className="tool" title="缩小" onClick={() => setZoom(zoom - 0.15)}>
                −
              </button>
              <button type="button" className="tool zoom-value" title="适应宽度" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="tool" title="放大" onClick={() => setZoom(zoom + 0.15)}>
                ＋
              </button>
            </div>

            <span className="tool-sep" />

            <div className="seg seg-small" role="group" aria-label="阅读区视图">
              <button type="button" aria-pressed={workspace.readerPanel === 'doc'} onClick={() => setReaderPanel('doc')}>
                阅读
              </button>
              <button type="button" aria-pressed={workspace.readerPanel === 'ann'} onClick={() => setReaderPanel('ann')}>
                标注 {pageAnnotations.length > 0 ? pageAnnotations.length : ''}
              </button>
            </div>

            <span className="tool-spacer" />

            <button type="button" className={`icon-btn${searchOpen ? ' is-active' : ''}`} title="在资料中查找" onClick={() => setSearchOpen(!searchOpen)}>
              ⌕
            </button>
          </div>

          {/* >>> integration:course-reading-annotation */}
          <ReaderToolbar
            tool={tool}
            onTool={setTool}
            color={color}
            onColor={setColor}
            showAnnotations={showAnnotations}
            onToggleAnnotations={(visible) => {
              setShowAnnotations(visible)
              if (resourceId) setReadingState(resourceId, { showAnnotations: visible })
            }}
            pan={panMode}
            onPan={setPanMode}
            canUndo={canUndo}
            undoLabel={undoLabel}
            onUndo={() => void undo()}
            filters={filters}
            onFilters={setFilters}
          />
          {/* <<< integration:course-reading-annotation */}

          {searchOpen ? (
            <div className="reader-search">
              <input
                autoFocus
                value={query}
                placeholder="在当前资料中查找"
                aria-label="查找文字"
                onChange={(event) => {
                  setQuery(event.target.value)
                  setMatchAt(0)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') goMatch(1)
                  if (event.key === 'Escape') setSearchOpen(false)
                }}
              />
              <span className="muted">
                {query ? (matches.length ? `${matchAt + 1} / ${matches.length}` : '没有匹配') : ''}
              </span>
              <button type="button" className="icon-btn" title="上一处" disabled={!matches.length} onClick={() => goMatch(-1)}>
                ↑
              </button>
              <button type="button" className="icon-btn" title="下一处" disabled={!matches.length} onClick={() => goMatch(1)}>
                ↓
              </button>
              <button
                type="button"
                className="icon-btn"
                title="关闭查找"
                onClick={() => {
                  setSearchOpen(false)
                  setQuery('')
                }}
              >
                ✕
              </button>
            </div>
          ) : null}

          <div className="reader-body">
            {/* >>> integration:course-reading-annotation */}
            {workspace.readerPanel === 'ann' ? (
              <AnnotationSidebar
                resourceId={resourceId ?? ''}
                resolved={filteredResolved}
                links={linksForResource}
                anchors={anchors}
                resources={resources}
                onJump={jumpTo}
                onUpdate={updateAnnotation}
                onRemove={removeItem}
                onAsk={askAbout}
                onAddToNote={addToNote}
                onNavigateLink={(linkId) => {
                  void navigation.navigateToLink(linkId).catch((error: Error) => notify(error.message || '无法打开关联来源', 'error'))
                }}
              />
            ) : file.kind === 'pdf' ? (
              <PdfViewer
                file={file}
                page={page}
                zoom={zoom}
                tool={tool}
                panMode={panMode}
                focusQuote={focusQuote && focusQuote.fileId === file.id ? focusQuote : null}
                searchTerm={searchOpen ? query.trim() : ''}
                scrollRestore={scrollRestore}
                overlay={overlay}
                onSelect={handleSelect}
                onAnnotationClick={handleAnnotationClick}
                onRegion={handleRegion}
                onViewState={handleViewState}
                onScrollRatio={handleScrollRatio}
                onVisiblePage={(target) => setPage(file.id, target)}
              />
            ) : (
              <DocViewer file={file} zoom={zoom} />
            )}
          </div>

          <div className="reader-foot">
            <span>{formatBytes(file.size)}</span>
            <span>{file.ext.toUpperCase()}</span>
            <span className="tool-spacer" />
            {file.changed ? <span className="flag is-error">文件已在外部修改</span> : null}
          </div>

          {popup ? (
            <SelectionMenu
              x={popup.x}
              y={popup.y}
              text={popup.text}
              initialNote={popup.note}
              onClose={() => setPopup(null)}
              capture={{ fileId: file.id, fileName: file.name, page }}
              onHighlight={(kind) => void commitCreate(popup.draft, kind)}
              onNote={(body) => void commitCreate(popup.draft, 'note', body)}
              onCopy={() => {
                void navigator.clipboard.writeText(popup.text)
                notify('已复制选中内容')
                setPopup(null)
              }}
              onAsk={() => {
                setSelection({ fileId: file.id, page, text: popup.text, draft: popup.draft })
                setPopup(null)
                focusComposer()
              }}
              onExplain={() => {
                setSelection({ fileId: file.id, page, text: popup.text, draft: popup.draft })
                setPopup(null)
                void sendQuestion('请解释这段内容的含义。')
              }}
              onAddToNote={() => {
                setSelection({ fileId: file.id, page, text: popup.text })
                insertSelectionToNote()
                setPopup(null)
              }}
            />
          ) : null}

          {selected ? (
              <AnnotationPopover
              x={selected.x}
              y={selected.y}
              items={selected.items}
              quote={quoteOf(selected.items[0])}
              onClose={() => setSelected(null)}
              onUpdate={updateAnnotation}
              onRemove={removeItem}
              onAsk={askAbout}
              onAddToNote={addToNote}
            />
          ) : null}
          {/* <<< integration:course-reading-annotation */}
        </>
      )}
    </section>
  )
}
