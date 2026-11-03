import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { cachedPdf, loadPdf } from '../lib/pdf'
import { locateQuoteRects, pageTextSelection } from '../lib/textLayer'
import type { FileRec, Rect } from '../types'
// >>> integration:course-reading-annotation
import type { Point, ShapeGeometry } from '../shared/contracts/content'
import { normalizeRect, pointFromClient } from '../reader/geometry'
import type { Rotation } from '../reader/geometry'
import type { ReaderTool } from '../reader/components/ReaderToolbar'
// <<< integration:course-reading-annotation

// >>> integration:course-reading-annotation
// The viewer now exposes its rendered page box to the reading module, accepts a
// normalised annotation overlay and captures region tools. The legacy
// `annotations` rect layer was replaced by AnnotationOverlay.
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
  overlay?: (view: { page: number; rotation: Rotation; width: number; height: number }) => ReactNode
  scrollRestore?: { ratio: number; nonce: number } | null
  onSelect: (payload: PdfSelectPayload) => void
  onAnnotationClick: (payload: PdfPointPayload) => void
  onRegion: (payload: PdfRegionPayload) => void
  onViewState: (state: PdfViewState) => void
  onScrollRatio: (ratio: number) => void
}

const REGION_TOOLS: ReaderTool[] = ['rect', 'ellipse', 'arrow', 'ink']
// <<< integration:course-reading-annotation

function normalizeRotation (value: number): Rotation {
  const rounded = ((Math.round(value / 90) * 90) % 360 + 360) % 360
  return rounded === 90 || rounded === 180 || rounded === 270 ? rounded : 0
}

export function PdfViewer ({
  file,
  page,
  zoom,
  focusQuote,
  searchTerm,
  tool,
  overlay,
  scrollRestore,
  onSelect,
  onAnnotationClick,
  onRegion,
  onViewState,
  onScrollRatio
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [hostWidth, setHostWidth] = useState(0)
  const [flash, setFlash] = useState<Rect[]>([])
  const [searchRects, setSearchRects] = useState<Rect[]>([])
  const [renderTick, setRenderTick] = useState(0)
  // >>> integration:course-reading-annotation
  const [drag, setDrag] = useState<{ start: Point; current: Point; points: Point[] } | null>(null)
  const rotationRef = useRef<Rotation>(0)
  const callbacks = useRef({ onSelect, onAnnotationClick, onRegion, onViewState, onScrollRatio })
  callbacks.current = { onSelect, onAnnotationClick, onRegion, onViewState, onScrollRatio }

  const regionTool = REGION_TOOLS.includes(tool)
  // <<< integration:course-reading-annotation

  useEffect(() => {
    let cancelled = false
    setError(null)
    setDoc(null)
    ;(async () => {
      try {
        let pdf = cachedPdf(file.id)
        if (!pdf) {
          const bytes = await window.cs.readBytes(file.path)
          pdf = await loadPdf(file.id, bytes)
        }
        if (!cancelled) setDoc(pdf)
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
    const observer = new ResizeObserver((entries) => setHostWidth(entries[0].contentRect.width))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || !canvasRef.current || !textRef.current || !pageRef.current) return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    ;(async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        const base = pdfPage.getViewport({ scale: 1 })
        const fit = Math.max(0.35, (hostWidth - 64) / base.width)
        const viewport = pdfPage.getViewport({ scale: fit * zoom })
        const rotation = normalizeRotation(viewport.rotation)
        rotationRef.current = rotation
        const canvas = canvasRef.current
        if (!canvas) return
        const context = canvas.getContext('2d')
        if (!context) return
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const task = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
        })
        renderTask = task
        await task.promise
        if (cancelled) return
        setBox({ width: viewport.width, height: viewport.height })

        const textDiv = textRef.current
        if (!textDiv) return
        textDiv.innerHTML = ''
        textDiv.style.setProperty('--total-scale-factor', String(viewport.scale))
        const layer = new TextLayer({
          textContentSource: await pdfPage.getTextContent(),
          container: textDiv,
          viewport
        })
        await layer.render()
        if (cancelled) return
        setRenderTick((value) => value + 1)
        callbacks.current.onViewState({
          page,
          rotation,
          width: viewport.width,
          height: viewport.height,
          element: pageRef.current,
          ready: true
        })
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== 'RenderingCancelledException') {
          setError((err as Error).message || '这一页渲染失败')
        }
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
      callbacks.current.onViewState({
        page,
        rotation: rotationRef.current,
        width: 0,
        height: 0,
        element: null,
        ready: false
      })
    }
  }, [doc, page, zoom, hostWidth])

  useEffect(() => {
    if (hostRef.current) hostRef.current.scrollTop = 0
  }, [page])

  useEffect(() => {
    if (!scrollRestore || !hostRef.current) return
    // >>> integration:course-reading-annotation
    const host = hostRef.current
    const frame = requestAnimationFrame(() => {
      host.scrollTop = scrollRestore.ratio * Math.max(0, host.scrollHeight - host.clientHeight)
    })
    return () => cancelAnimationFrame(frame)
    // <<< integration:course-reading-annotation
  }, [scrollRestore, renderTick])

  useEffect(() => {
    if (!focusQuote || focusQuote.page !== page || !pageRef.current) return
    const rects = locateQuoteRects(pageRef.current, focusQuote.quote)
    if (!rects.length) return
    setFlash(rects)
    const timer = setTimeout(() => setFlash([]), 2400)
    return () => clearTimeout(timer)
  }, [focusQuote, page, renderTick])

  useEffect(() => {
    if (!searchTerm || !pageRef.current) {
      setSearchRects([])
      return
    }
    setSearchRects(locateQuoteRects(pageRef.current, searchTerm))
  }, [searchTerm, page, renderTick])

  // >>> integration:course-reading-annotation
  const pointAt = (event: { clientX: number; clientY: number }): Point => {
    const element = pageRef.current
    if (!element) return [0, 0]
    return pointFromClient(element.getBoundingClientRect(), event.clientX, event.clientY)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!regionTool) return
    event.preventDefault()
    const point = pointAt(event)
    setDrag({ start: point, current: point, points: [point] })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const point = pointAt(event)
    setDrag((current) => {
      if (!current) return current
      return {
        ...current,
        current: point,
        points: tool === 'ink' ? [...current.points, point] : current.points
      }
    })
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const point = pointAt(event)
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
    if (geometry) {
      callbacks.current.onRegion({
        geometry,
        point,
        page,
        rotation: rotationRef.current,
        x: event.clientX,
        y: event.clientY
      })
    }
  }

  const handleMouseUp = (event: ReactMouseEvent) => {
    if (regionTool) return
    const element = pageRef.current
    if (!element || !element.contains(event.target as Node)) return
    const selection = pageTextSelection(element)
    if (selection) {
      callbacks.current.onSelect({ ...selection, x: event.clientX, y: event.clientY })
      return
    }
    callbacks.current.onAnnotationClick({
      point: pointAt(event),
      page,
      rotation: rotationRef.current,
      x: event.clientX,
      y: event.clientY
    })
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
      className="pdf-stage"
      ref={hostRef}
      onMouseUp={handleMouseUp}
      onScroll={(event) => {
        const element = event.currentTarget
        const max = element.scrollHeight - element.clientHeight
        callbacks.current.onScrollRatio(max > 0 ? element.scrollTop / max : 0)
      }}
    >
      <div
        className={`pdf-page${regionTool ? ' is-region-tool' : ''}`}
        ref={pageRef}
        style={box.width ? { width: box.width, height: box.height } : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
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
        {/* >>> integration:course-reading-annotation */}
        {overlay && box.width ? overlay({ page, rotation: rotationRef.current, width: box.width, height: box.height }) : null}
        {drag ? <DragPreview drag={drag} tool={tool} width={box.width} height={box.height} /> : null}
        {/* <<< integration:course-reading-annotation */}
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
      </div>
    </div>
  )
}

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
