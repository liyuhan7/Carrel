import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { cachedPdf, loadPdf } from '../lib/pdf'
import {
  lineTargets,
  locateQuoteRects,
  pageElementOf,
  pageTextSelection,
  setTextSelection,
  snapSelectionToLine,
  textTargetAt,
  wordTargets,
  type TextTarget
} from '../lib/textLayer'
import type { FileRec, Rect } from '../types'
// >>> integration:course-reading-annotation
import type { Point, ShapeGeometry } from '../shared/contracts/content'
import { normalizeRect, pointFromClient } from '../reader/geometry'
import type { Rotation } from '../reader/geometry'
import type { ReaderTool } from '../reader/components/ReaderToolbar'
// <<< integration:course-reading-annotation

// >>> integration:course-reading-annotation
// Pages are stacked in one scroll container, so the reader behaves like a
// normal PDF preview: scrolling turns pages. Only the visible page and its
// neighbours keep a canvas and a text layer; the rest hold their box.
export interface PdfViewState {
  page: number
  rotation: Rotation
  width: number
  height: number
  element: HTMLElement | null
  ready: boolean
}

export interface PdfSelectPayload {
  text: string
  rects: Rect[]
  x: number
  y: number
}

export interface PdfPointPayload {
  point: Point
  page: number
  rotation: Rotation
  x: number
  y: number
}

export interface PdfRegionPayload extends PdfPointPayload {
  geometry: ShapeGeometry
}

interface Props {
  file: FileRec
  page: number
  zoom: number
  focusQuote: { page: number; quote: string; nonce: number } | null
  searchTerm?: string
  tool: ReaderTool
  /** Hand tool: a left drag pans the page instead of selecting text. */
  panMode?: boolean
  overlay?: (view: { page: number; rotation: Rotation; width: number; height: number }) => ReactNode
  scrollRestore?: { ratio: number; nonce: number } | null
  onSelect: (payload: PdfSelectPayload) => void
  onAnnotationClick: (payload: PdfPointPayload) => void
  onRegion: (payload: PdfRegionPayload) => void
  onViewState: (state: PdfViewState) => void
  onScrollRatio: (ratio: number) => void
  /** The page the reader is looking at; the store keeps it as the reading position. */
  onVisiblePage: (page: number) => void
}

const REGION_TOOLS: ReaderTool[] = ['rect', 'ellipse', 'arrow', 'ink']
/** Distance kept above a page when jumping to it. */
const PAGE_TOP_MARGIN = 8
/** Pages kept rendered around the visible one: visible page plus neighbours. */
const RENDER_WINDOW = 1
// <<< integration:course-reading-annotation

interface PageInfo {
  page: number
  /** Page box at scale 1, already rotated. */
  width: number
  height: number
  rotation: Rotation
}

interface DragState {
  page: number
  start: Point
  current: Point
  points: Point[]
}

function normalizeRotation (value: number): Rotation {
  const rounded = ((Math.round(value / 90) * 90) % 360 + 360) % 360
  return rounded === 90 || rounded === 180 || rounded === 270 ? rounded : 0
}

/** Fit the page to the host width, then apply the reader zoom. */
function scaleFor (info: PageInfo, hostWidth: number, zoom: number): number {
  return Math.max(0.35, (hostWidth - 64) / info.width) * zoom
}

/** Where the viewport centre sits inside a page, as fractions of the page box. */
function centreAnchor (
  host: HTMLDivElement,
  hostBox: DOMRect,
  page: number,
  element: HTMLElement
): { page: number; ratioX: number; ratioY: number } {
  const box = element.getBoundingClientRect()
  const left = box.left - hostBox.left + host.scrollLeft
  const top = box.top - hostBox.top + host.scrollTop
  return {
    page,
    ratioX: (host.scrollLeft + host.clientWidth / 2 - left) / (box.width || 1),
    ratioY: (host.scrollTop + host.clientHeight / 2 - top) / (box.height || 1)
  }
}

/** Pointer travel below this is a click, not a drag. */
const CLICK_SLOP = 10

/** A press starts selecting once it travels this far; below CLICK_SLOP, so a
 *  drag reacts at once while a click still commits nothing. */
const SELECT_SLOP = 3

/** Three pages keep a canvas at a time; cap each bitmap so zoom cannot exhaust memory. */
const MAX_CANVAS_PIXELS = 12_000_000

function pixelRatioFor (width: number, height: number): number {
  const base = Math.min(window.devicePixelRatio || 1, 2)
  const area = Math.max(1, width * height)
  return Math.min(base, Math.sqrt(MAX_CANVAS_PIXELS / area))
}

export function PdfViewer ({
  file,
  page,
  zoom,
  focusQuote,
  searchTerm,
  tool,
  panMode = false,
  overlay,
  scrollRestore,
  onSelect,
  onAnnotationClick,
  onRegion,
  onViewState,
  onScrollRatio,
  onVisiblePage
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hostWidth, setHostWidth] = useState(0)
  const [infos, setInfos] = useState<PageInfo[]>([])
  const [current, setCurrent] = useState(page)
  const [surfaceTick, setSurfaceTick] = useState(0)
  const [drag, setDrag] = useState<DragState | null>(null)

  const currentRef = useRef(page)
  const pageRef = useRef(page)
  pageRef.current = page
  const infosRef = useRef<PageInfo[]>([])
  infosRef.current = infos
  const infoByPage = useRef(new Map<number, PageInfo>())
  infoByPage.current = new Map(infos.map((info) => [info.page, info]))
  const layoutRef = useRef({ hostWidth, zoom })
  layoutRef.current = { hostWidth, zoom }
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const readyRef = useRef(new Set<number>())
  const anchorRef = useRef<{ page: number; ratioX: number; ratioY: number } | null>(null)
  const placedRef = useRef(false)
  const restoredRef = useRef(0)
  const frameRef = useRef(0)
  /** Where the press landed: used for the click/drag decision and margin snapping. */
  const downPointRef = useRef<{ x: number; y: number } | null>(null)
  /** Drag selection owned by the viewer, so Chromium cannot snap it to whole lines. */
  const selectDragRef = useRef<{ anchor: TextTarget; page: HTMLElement; fixed?: boolean } | null>(null)
  const dragCommittedRef = useRef(false)
  /** Click count for double/triple click word and line selection. */
  const lastClickRef = useRef<{ time: number; x: number; y: number; clicks: number } | null>(null)
  /** Latest pointer position while a drag selection is active. */
  const dragPointRef = useRef<{ x: number; y: number } | null>(null)
  const dragApplyingRef = useRef(false)
  /** Set once the press has travelled far enough to count as a drag. */
  const dragMovedRef = useRef(false)
  /** Pan in flight: pointer start plus the scroll offset it began at. */
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const spaceRef = useRef(false)
  const [panning, setPanning] = useState(false)
  const [handMode, setHandMode] = useState(false)

  const callbacks = useRef({ onSelect, onAnnotationClick, onRegion, onViewState, onScrollRatio, onVisiblePage })
  callbacks.current = { onSelect, onAnnotationClick, onRegion, onViewState, onScrollRatio, onVisiblePage }

  const regionTool = REGION_TOOLS.includes(tool)
  // <<< integration:course-reading-annotation

  /** Hand the rendered page box to the reading module; called on every interaction. */
  const reportPage = useCallback((target: number) => {
    const element = pageEls.current.get(target)
    const info = infoByPage.current.get(target)
    if (!element || !info) return
    const scale = scaleFor(info, layoutRef.current.hostWidth, layoutRef.current.zoom)
    callbacks.current.onViewState({
      page: target,
      rotation: info.rotation,
      width: info.width * scale,
      height: info.height * scale,
      element,
      ready: readyRef.current.has(target)
    })
  }, [])

  const register = useCallback((target: number, element: HTMLDivElement | null) => {
    if (element) pageEls.current.set(target, element)
    else pageEls.current.delete(target)
  }, [])

  const handleSurface = useCallback((target: number, ready: boolean) => {
    if (ready) readyRef.current.add(target)
    else readyRef.current.delete(target)
    setSurfaceTick((tick) => tick + 1)
  }, [])

  /** Make `target` the page the reader is on, and let the store know. */
  const activate = useCallback((target: number) => {
    if (target !== currentRef.current) {
      currentRef.current = target
      setCurrent(target)
      callbacks.current.onVisiblePage(target)
    }
    reportPage(target)
  }, [reportPage])

  /** Derive the visible page from the scroll offset and remember the anchor. */
  const measure = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const hostBox = host.getBoundingClientRect()
    const max = host.scrollHeight - host.clientHeight
    callbacks.current.onScrollRatio(max > 0 ? Math.min(1, Math.max(0, host.scrollTop / max)) : 0)

    // The page that owns the top of the viewport is the one being read; a jump
    // to a page lands on that page instead of its neighbour.
    const probe = host.scrollTop + host.clientHeight * 0.12
    let found = 0
    for (const info of infosRef.current) {
      const element = pageEls.current.get(info.page)
      if (!element) continue
      const box = element.getBoundingClientRect()
      const top = box.top - hostBox.top + host.scrollTop
      if (top > probe) break
      found = info.page
      if (probe < top + box.height) break
    }
    if (!found) found = infosRef.current[0]?.page ?? 1
    // A short last page can end above the probe; at the bottom it is the page read.
    if (max > 0 && host.scrollTop >= max - 2) {
      found = infosRef.current[infosRef.current.length - 1]?.page ?? found
    }

    const anchorElement = pageEls.current.get(found)
    if (anchorElement) {
      anchorRef.current = centreAnchor(host, hostBox, found, anchorElement)
    }
    if (found !== currentRef.current) {
      currentRef.current = found
      setCurrent(found)
      callbacks.current.onVisiblePage(found)
      reportPage(found)
    }
  }, [reportPage])

  const scrollToPage = useCallback((target: number): boolean => {
    const host = hostRef.current
    const element = pageEls.current.get(target)
    if (!host || !element) return false
    const hostBox = host.getBoundingClientRect()
    const top = element.getBoundingClientRect().top - hostBox.top + host.scrollTop
    host.scrollTop = Math.max(0, top - PAGE_TOP_MARGIN)
    anchorRef.current = centreAnchor(host, hostBox, target, element)
    activate(target)
    return true
  }, [activate])

  const scrollToRatio = useCallback((ratio: number) => {
    const host = hostRef.current
    if (!host) return
    host.scrollTop = Math.min(1, Math.max(0, ratio)) * Math.max(0, host.scrollHeight - host.clientHeight)
    measure()
  }, [measure])

  // Load the document, then every page box so the stack has a stable height.
  useEffect(() => {
    let cancelled = false
    setError(null)
    setDoc(null)
    setInfos([])
    setDrag(null)
    placedRef.current = false
    anchorRef.current = null
    readyRef.current.clear()
    pageEls.current.clear()
    currentRef.current = pageRef.current
    setCurrent(pageRef.current)
    ;(async () => {
      try {
        let loaded = cachedPdf(file.id)
        if (!loaded) {
          const bytes = await window.cs.readBytes(file.path)
          loaded = await loadPdf(file.id, bytes)
        }
        const proxy = loaded
        if (cancelled) return
        setDoc(proxy)
        const collected: PageInfo[] = []
        for (let start = 1; start <= proxy.numPages; start += 8) {
          const end = Math.min(proxy.numPages, start + 7)
          const batch = await Promise.all(
            Array.from({ length: end - start + 1 }, (_, index) => proxy.getPage(start + index))
          )
          for (const pdfPage of batch) {
            const viewport = pdfPage.getViewport({ scale: 1 })
            collected.push({
              page: pdfPage.pageNumber,
              width: viewport.width,
              height: viewport.height,
              rotation: normalizeRotation(viewport.rotation)
            })
          }
          if (cancelled) return
        }
        collected.sort((a, b) => a.page - b.page)
        if (!cancelled) setInfos(collected)
      } catch (err) {
        if (!cancelled) setError((err as Error).message || '无法打开该文件')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file.id, file.path])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    setHostWidth(host.clientWidth)
    const observer = new ResizeObserver(() => setHostWidth(host.clientWidth))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // Report the current page box whenever it changes size or becomes ready.
  useEffect(() => {
    if (!infos.length) return
    reportPage(currentRef.current)
  }, [infos.length, hostWidth, zoom, surfaceTick, reportPage])

  useEffect(() => () => {
    callbacks.current.onViewState({ page: currentRef.current, rotation: 0, width: 0, height: 0, element: null, ready: false })
  }, [])

  // Land on the stored page once the stack exists.
  useEffect(() => {
    if (placedRef.current || !infos.length) return
    placedRef.current = page <= 1 ? true : scrollToPage(page)
    // Record the viewport centre so the first zoom keeps it.
    measure()
  }, [infos.length, page, scrollToPage, measure])

  // A page coming from outside the viewer (page input, annotation, citation).
  useEffect(() => {
    if (!infos.length || page === currentRef.current) return
    scrollToPage(page)
  }, [page, infos.length, scrollToPage])

  // Restore the scroll position of the previous session.
  useEffect(() => {
    if (!scrollRestore || !infos.length || restoredRef.current === scrollRestore.nonce) return
    restoredRef.current = scrollRestore.nonce
    scrollToRatio(scrollRestore.ratio)
  }, [scrollRestore, infos.length, scrollToRatio])

  // Zoom around the viewport centre: the page point under it stays put.
  useLayoutEffect(() => {
    const host = hostRef.current
    const anchor = anchorRef.current
    if (!host || !anchor) return
    const element = pageEls.current.get(anchor.page)
    if (!element) return
    const hostBox = host.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const left = box.left - hostBox.left + host.scrollLeft
    const top = box.top - hostBox.top + host.scrollTop
    host.scrollTop = Math.max(0, top + anchor.ratioY * box.height - host.clientHeight / 2)
    host.scrollLeft = Math.max(0, left + anchor.ratioX * box.width - host.clientWidth / 2)
    measure()
  }, [zoom, hostWidth, infos.length, measure])

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
  }, [])

  // Space is the hand-tool modifier: with it held, a left drag pans even over text.
  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      if (!element) return false
      if (element.isContentEditable) return true
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(element.tagName)) return true
      return Boolean(element.closest?.('button, a, [role="button"], [contenteditable="true"]'))
    }
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || typing(event.target)) return
      event.preventDefault()
      spaceRef.current = true
      setHandMode(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceRef.current = false
      setHandMode(false)
    }
    const blur = () => {
      spaceRef.current = false
      setHandMode(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const handleScroll = () => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      measure()
    })
  }

  // >>> integration:course-reading-annotation
  /** Read the current selection (or the annotation under the pointer) and report it. */
  const commitSelection = (pageElement: HTMLElement, clientX: number, clientY: number) => {
    const targetPage = Number(pageElement.dataset.pdfPage)
    if (!Number.isFinite(targetPage)) return
    const picked = pageTextSelection(pageElement)
    if (picked) {
      callbacks.current.onSelect({ ...picked, x: clientX, y: clientY })
      return
    }
    const info = infoByPage.current.get(targetPage)
    if (!info) return
    callbacks.current.onAnnotationClick({
      point: pointFromClient(pageElement.getBoundingClientRect(), clientX, clientY),
      page: targetPage,
      rotation: info.rotation,
      x: clientX,
      y: clientY
    })
  }

  const handleMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (regionTool) return
    // A drag owned by the viewer already committed on pointerup.
    if (dragCommittedRef.current) {
      dragCommittedRef.current = false
      return
    }
    const target = event.target instanceof Element ? event.target : null
    if (!target || !target.closest('.pdf-page')) return
    const selection = window.getSelection()
    const hasSelection = Boolean(selection && !selection.isCollapsed && selection.rangeCount)
    const startNode = hasSelection && selection ? selection.getRangeAt(0).startContainer : null
    const pageElement =
      pageElementOf(startNode) ?? target.closest<HTMLElement>('[data-pdf-page]')
    if (!pageElement) return
    const targetPage = Number(pageElement.dataset.pdfPage)
    if (!Number.isFinite(targetPage)) return
    activate(targetPage)
    if (hasSelection && selection) {
      // A range that left the text resolves to a position in the middle of the
      // flat layer; snap it onto the line under the pointer before reading it.
      const range = selection.getRangeAt(0)
      const focus = { x: event.clientX, y: event.clientY }
      const anchor = downPointRef.current ?? focus
      if (snapSelectionToLine(pageElement, range, anchor, focus)) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
    commitSelection(pageElement, event.clientX, event.clientY)
  }

  /** True once the page is wider than the viewport, i.e. there is horizontal
   *  slack to pan. Vertical overflow is ordinary page scrolling. */
  const canPan = () => {
    const host = hostRef.current
    if (!host) return false
    return host.scrollWidth - host.clientWidth > 1
  }

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current
    if (!host) return false
    selectDragRef.current = null
    setDrag(null)
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: host.scrollLeft,
      top: host.scrollTop
    }
    setPanning(true)
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    return true
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    downPointRef.current = { x: event.clientX, y: event.clientY }
    dragCommittedRef.current = false
    selectDragRef.current = null
    const target = event.target instanceof Element ? event.target : null
    const pageElement = target?.closest<HTMLElement>('[data-pdf-page]') ?? null

    // Pan first, so the hand tool also works while a region tool is armed:
    // middle button, or left button with space held, pans anywhere. Plain
    // left-drags on blank paper pan too (below).
    if (
      event.pointerType !== 'touch' &&
      (event.button === 1 || (event.button === 0 && (panMode || spaceRef.current)))
    ) {
      if (startPan(event)) return
    }

    if (regionTool) {
      if (!pageElement) return
      const targetPage = Number(pageElement.dataset.pdfPage)
      if (!Number.isFinite(targetPage)) return
      event.preventDefault()
      activate(targetPage)
      const point = pointFromClient(pageElement.getBoundingClientRect(), event.clientX, event.clientY)
      setDrag({ page: targetPage, start: point, current: point, points: [point] })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    // The viewer owns drag selection: on absolutely positioned spans the browser
    // snaps to whole line boxes and flips direction across gaps. Shift-clicks and
    // touch keep native behaviour.
    if (!pageElement) {
      // The gutter between pages is blank paper: drag it to pan once the page
      // overflows, otherwise leave the press to the browser.
      if (canPan()) startPan(event)
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    dragPointRef.current = point
    dragMovedRef.current = false
    const now = Date.now()
    const last = lastClickRef.current
    const repeat = Boolean(last && now - last.time < 450 && Math.abs(last.x - point.x) <= 4 && Math.abs(last.y - point.y) <= 4)
    const clicks = repeat && last ? last.clicks + 1 : 1
    lastClickRef.current = { time: now, x: point.x, y: point.y, clicks }
    const anchor = textTargetAt(pageElement, point)
    if (!anchor) {
      // No text under the press: drop any earlier selection so the click cannot
      // reuse it.
      window.getSelection()?.removeAllRanges()
      // Zoomed in, blank paper is where the page gets grabbed.
      if (canPan()) startPan(event)
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (clicks >= 2) {
      const range = clicks >= 3 ? lineTargets(anchor) : wordTargets(anchor)
      setTextSelection(range.start, range.end)
      selectDragRef.current = { anchor: range.start, page: pageElement, fixed: true }
      return
    }
    selectDragRef.current = { anchor, page: pageElement }
    window.getSelection()?.removeAllRanges()
  }

  /** Rebuild the drag selection from the anchor and the latest pointer position. */
  const applyDragSelection = useCallback(() => {
    const selectDrag = selectDragRef.current
    const point = dragPointRef.current
    if (!selectDrag || !point || dragApplyingRef.current) return
    const focus = textTargetAt(selectDrag.page, point)
    if (!focus) return
    const selection = window.getSelection()
    if (selection && selection.rangeCount === 1) {
      const current = selection.getRangeAt(0)
      const desired = document.createRange()
      try {
        desired.setStart(selectDrag.anchor.node, selectDrag.anchor.offset)
        desired.setEnd(focus.node, focus.offset)
      } catch {
        desired.setStart(focus.node, focus.offset)
        desired.setEnd(selectDrag.anchor.node, selectDrag.anchor.offset)
      }
      if (
        current.startContainer === desired.startContainer &&
        current.startOffset === desired.startOffset &&
        current.endContainer === desired.endContainer &&
        current.endOffset === desired.endOffset
      ) return
    }
    dragApplyingRef.current = true
    setTextSelection(selectDrag.anchor, focus)
    dragApplyingRef.current = false
  }, [])

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan) {
      const host = hostRef.current
      if (!host) return
      host.scrollLeft = pan.left - (event.clientX - pan.x)
      host.scrollTop = pan.top - (event.clientY - pan.y)
      return
    }
    const selectDrag = selectDragRef.current
    if (selectDrag) {
      if (!selectDrag.fixed) {
        const point = { x: event.clientX, y: event.clientY }
        dragPointRef.current = point
        if (!dragMovedRef.current) {
          const start = downPointRef.current
          if (start && Math.hypot(point.x - start.x, point.y - start.y) < SELECT_SLOP) return
          dragMovedRef.current = true
        }
        applyDragSelection()
      }
      return
    }
    if (!drag) return
    const element = pageEls.current.get(drag.page)
    if (!element) return
    const point = pointFromClient(element.getBoundingClientRect(), event.clientX, event.clientY)
    setDrag((state) => {
      if (!state) return state
      return {
        ...state,
        current: point,
        points: tool === 'ink' ? [...state.points, point] : state.points
      }
    })
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null
      setPanning(false)
      dragCommittedRef.current = true
      return
    }
    const selectDrag = selectDragRef.current
    if (selectDrag && !selectDrag.fixed) {
      const point = { x: event.clientX, y: event.clientY }
      const start = downPointRef.current
      dragPointRef.current = point
      selectDragRef.current = null
      dragCommittedRef.current = true
      if (!start || Math.hypot(point.x - start.x, point.y - start.y) < CLICK_SLOP) {
        // A click: drop the previewed range, then only look for an annotation
        // under the pointer.
        window.getSelection()?.removeAllRanges()
        commitSelection(selectDrag.page, point.x, point.y)
        return
      }
      applyDragSelection()
      // A drag reports text only; its end point is not a click on an annotation.
      const picked = pageTextSelection(selectDrag.page)
      if (picked) callbacks.current.onSelect({ ...picked, x: point.x, y: point.y })
      return
    }
    if (selectDrag) {
      selectDragRef.current = null
      dragCommittedRef.current = true
      commitSelection(selectDrag.page, event.clientX, event.clientY)
      return
    }
    if (!drag) return
    const element = pageEls.current.get(drag.page)
    const info = infoByPage.current.get(drag.page)
    const point = element
      ? pointFromClient(element.getBoundingClientRect(), event.clientX, event.clientY)
      : drag.current
    let geometry: ShapeGeometry | null = null
    if (tool === 'ink') {
      const points = [...drag.points, point]
      geometry = points.length >= 2 ? { type: 'ink', points } : null
    } else if (tool === 'arrow') {
      if (Math.abs(point[0] - drag.start[0]) > 0.001 || Math.abs(point[1] - drag.start[1]) > 0.001) {
        geometry = { type: 'arrow', from: drag.start, to: point }
      }
    } else {
      const bounds = normalizeRect([
        Math.min(drag.start[0], point[0]),
        Math.min(drag.start[1], point[1]),
        Math.abs(point[0] - drag.start[0]),
        Math.abs(point[1] - drag.start[1])
      ])
      if (bounds && bounds[2] > 0.002 && bounds[3] > 0.002) {
        geometry = { type: tool === 'ellipse' ? 'ellipse' : 'rect', rect: bounds }
      }
    }
    setDrag(null)
    if (geometry && info) {
      callbacks.current.onRegion({
        geometry,
        point,
        page: drag.page,
        rotation: info.rotation,
        x: event.clientX,
        y: event.clientY
      })
    }
  }
  // <<< integration:course-reading-annotation

  if (error) {
    return (
      <div className="doc-error">
        <p>无法显示这份 PDF</p>
        <span>{error}</span>
      </div>
    )
  }

  return (
    <div
      className={`pdf-stage${panning ? ' is-panning' : handMode || panMode ? ' is-hand' : ''}`}
      ref={hostRef}
      onScroll={handleScroll}
      onMouseUp={handleMouseUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        panRef.current = null
        setPanning(false)
        setDrag(null)
      }}
    >
      {infos.length ? (
        <div className="pdf-stack">
          {infos.map((info) => (
            <PdfPage
              key={info.page}
              doc={doc}
              info={info}
              scale={scaleFor(info, hostWidth, zoom)}
              active={Math.abs(info.page - current) <= RENDER_WINDOW}
              regionTool={regionTool}
              tool={tool}
              searchTerm={searchTerm ?? ''}
              flashQuote={focusQuote}
              drag={drag && drag.page === info.page ? drag : null}
              overlay={overlay}
              register={register}
              onSurface={handleSurface}
            />
          ))}
        </div>
      ) : (
        <div className="pdf-loading">正在排版页面…</div>
      )}
    </div>
  )
}

interface PageProps {
  doc: PDFDocumentProxy | null
  info: PageInfo
  scale: number
  active: boolean
  regionTool: boolean
  tool: ReaderTool
  searchTerm: string
  flashQuote: { page: number; quote: string; nonce: number } | null
  drag: DragState | null
  overlay?: (view: { page: number; rotation: Rotation; width: number; height: number }) => ReactNode
  register: (page: number, element: HTMLDivElement | null) => void
  onSurface: (page: number, ready: boolean) => void
}

/**
 * One page of the stack. The box is always in the layout so scrolling and the
 * page count stay stable; the canvas and the text layer only exist while the
 * page is near the viewport.
 */
const PdfPage = memo(function PdfPage ({
  doc,
  info,
  scale,
  active,
  regionTool,
  tool,
  searchTerm,
  flashQuote,
  drag,
  overlay,
  register,
  onSurface
}: PageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const generationRef = useRef(0)
  const [tick, setTick] = useState(0)
  const [failed, setFailed] = useState(false)
  const [searchRects, setSearchRects] = useState<Rect[]>([])
  const [flash, setFlash] = useState<Rect[]>([])

  const width = info.width * scale
  const height = info.height * scale

  const setRef = useCallback((element: HTMLDivElement | null) => {
    pageRef.current = element
    register(info.page, element)
  }, [register, info.page])

  useEffect(() => {
    if (!active || !doc) return
    const canvas = canvasRef.current
    const textDiv = textRef.current
    if (!canvas || !textDiv) return
    // A zoom change can start a new render before the previous one settles;
    // only the newest generation may touch this page's DOM.
    const generation = ++generationRef.current
    const stale = () => generationRef.current !== generation
    let task: { cancel: () => void } | null = null
    setFailed(false)
    ;(async () => {
      try {
        const pdfPage = await doc.getPage(info.page)
        if (stale()) return
        const viewport = pdfPage.getViewport({ scale })
        const context = canvas.getContext('2d')
        if (!context) return
        const dpr = pixelRatioFor(viewport.width, viewport.height)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const render = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
        })
        task = render
        await render.promise
        if (stale()) return
        const textContent = await pdfPage.getTextContent()
        if (stale()) return
        textDiv.innerHTML = ''
        textDiv.style.setProperty('--total-scale-factor', String(viewport.scale))
        const layer = new TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport
        })
        await layer.render()
        if (stale()) {
          textDiv.innerHTML = ''
          return
        }
        onSurface(info.page, true)
        setTick((value) => value + 1)
      } catch (err) {
        if (!stale() && (err as Error)?.name !== 'RenderingCancelledException') setFailed(true)
      }
    })()
    return () => {
      generationRef.current += 1
      task?.cancel()
      onSurface(info.page, false)
      // Release the bitmap and the text layer; the page box keeps the layout.
      canvas.width = 0
      canvas.height = 0
      canvas.style.width = ''
      canvas.style.height = ''
      textDiv.innerHTML = ''
    }
  }, [active, doc, info.page, scale, onSurface])

  useEffect(() => {
    const element = pageRef.current
    if (!element || !tick || !searchTerm) {
      setSearchRects([])
      return
    }
    setSearchRects(locateQuoteRects(element, searchTerm))
  }, [searchTerm, tick])

  useEffect(() => {
    const element = pageRef.current
    if (!element || !tick || !flashQuote || flashQuote.page !== info.page) return
    const rects = locateQuoteRects(element, flashQuote.quote)
    if (!rects.length) return
    setFlash(rects)
    const timer = setTimeout(() => setFlash([]), 2400)
    return () => clearTimeout(timer)
  }, [flashQuote, info.page, tick])

  return (
    <div
      className={`pdf-page${regionTool ? ' is-region-tool' : ''}`}
      ref={setRef}
      data-pdf-page={info.page}
      data-pdf-rotation={info.rotation}
      style={{ width, height }}
    >
      {active ? (
        <>
          <canvas ref={canvasRef} className="pdf-canvas" />
          <div className="search-layer" aria-hidden="true">
            {searchRects.map((rect, index) => (
              <span
                key={index}
                className="search-rect"
                style={{
                  left: `${rect[0] * 100}%`,
                  top: `${rect[1] * 100}%`,
                  width: `${rect[2] * 100}%`,
                  height: `${rect[3] * 100}%`
                }}
              />
            ))}
          </div>
          <div className="textLayer" ref={textRef} />
          {overlay ? overlay({ page: info.page, rotation: info.rotation, width, height }) : null}
          {drag ? <DragPreview drag={drag} tool={tool} width={width} height={height} /> : null}
          <div className="flash-layer" aria-hidden="true">
            {flash.map((rect, index) => (
              <span
                key={index}
                className="flash-rect"
                style={{
                  left: `${rect[0] * 100}%`,
                  top: `${rect[1] * 100}%`,
                  width: `${rect[2] * 100}%`,
                  height: `${rect[3] * 100}%`
                }}
              />
            ))}
          </div>
          {failed ? <span className="pdf-page-failed">这一页渲染失败</span> : null}
        </>
      ) : null}
    </div>
  )
})

function DragPreview ({
  drag,
  tool,
  width,
  height
}: {
  drag: { start: Point; current: Point; points: Point[] }
  tool: ReaderTool
  width: number
  height: number
}) {
  if (!width || !height) return null
  const px = (point: Point): [number, number] => [point[0] * width, point[1] * height]
  const [x1, y1] = px(drag.start)
  const [x2, y2] = px(drag.current)

  if (tool === 'ink') {
    const points = drag.points.map((point) => px(point).join(',')).join(' ')
    return (
      <svg className="anno-shape" width={width} height={height} aria-hidden="true">
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
      </svg>
    )
  }
  if (tool === 'arrow') {
    return (
      <svg className="anno-shape" width={width} height={height} aria-hidden="true">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" />
      </svg>
    )
  }
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const boxWidth = Math.abs(x2 - x1)
  const boxHeight = Math.abs(y2 - y1)
  if (tool === 'ellipse') {
    return (
      <svg className="anno-shape" width={width} height={height} aria-hidden="true">
        <ellipse
          cx={left + boxWidth / 2}
          cy={top + boxHeight / 2}
          rx={boxWidth / 2}
          ry={boxHeight / 2}
          fill="rgba(95,111,121,0.08)"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      </svg>
    )
  }
  return (
    <span
      className="anno-drag-preview"
      style={{ left, top, width: boxWidth, height: boxHeight }}
      aria-hidden="true"
    />
  )
}
