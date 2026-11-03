import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { cachedPdf, loadPdf } from '../lib/pdf'
import { locateQuoteRects, pageTextSelection } from '../lib/textLayer'
import type { Annotation, FileRec, Rect } from '../types'

interface Props {
  file: FileRec
  page: number
  zoom: number
  annotations: Annotation[]
  focusQuote: { page: number; quote: string; nonce: number } | null
  searchTerm?: string
  onSelect: (payload: { text: string; rects: Rect[]; x: number; y: number }) => void
}

export function PdfViewer ({ file, page, zoom, annotations, focusQuote, searchTerm, onSelect }: Props) {
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
        if (!cancelled) setRenderTick((value) => value + 1)
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== 'RenderingCancelledException') {
          setError((err as Error).message || '这一页渲染失败')
        }
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, page, zoom, hostWidth])

  useEffect(() => {
    if (hostRef.current) hostRef.current.scrollTop = 0
  }, [page])

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

  const handleMouseUp = (event: ReactMouseEvent) => {
    const element = pageRef.current
    if (!element) return
    const selection = pageTextSelection(element)
    if (!selection) return
    onSelect({ ...selection, x: event.clientX, y: event.clientY })
  }

  if (error) {
    return (
      <div className="doc-error">
        <p>无法显示这份 PDF</p>
        <span>{error}</span>
      </div>
    )
  }

  return (
    <div className="pdf-stage" ref={hostRef} onMouseUp={handleMouseUp}>
      <div className="pdf-page" ref={pageRef} style={box.width ? { width: box.width, height: box.height } : undefined}>
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div className="anno-layer" aria-hidden="true">
          {annotations.map((annotation) =>
            annotation.rects.map((rect, index) => (
              <span
                key={`${annotation.id}-${index}`}
                className="anno-rect"
                style={{
                  left: `${rect[0] * 100}%`,
                  top: `${rect[1] * 100}%`,
                  width: `${rect[2] * 100}%`,
                  height: `${rect[3] * 100}%`
                }}
              />
            ))
          )}
        </div>
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
