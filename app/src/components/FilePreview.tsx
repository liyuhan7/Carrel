// Preview for a library file: page one for PDFs, the real text opening for
// Markdown, the image itself for pictures, and a compact label otherwise.
import { useEffect, useState } from 'react'
import type { FileRec } from '../types'
import { TypeBadge } from './TypeBadge'
import { cachedPdf, loadPdf } from '../lib/pdf'

const cache = new Map<string, string>()
const textCache = new Map<string, string[]>()

function keyOf (file: FileRec, width: number): string {
  return `${file.id}:${file.hash}:${width}`
}

async function renderPdfThumb (file: FileRec, width: number): Promise<string | null> {
  let doc = cachedPdf(file.id)
  if (!doc) {
    const bytes = await window.cs.readBytes(file.path)
    doc = await loadPdf(file.id, bytes)
  }
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: context, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.82)
}

async function renderImageThumb (file: FileRec): Promise<string | null> {
  const bytes = await window.cs.readBytes(file.path)
  const ext = file.ext.toLowerCase() === 'jpg' ? 'jpeg' : file.ext.toLowerCase()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return URL.createObjectURL(new Blob([buffer], { type: `image/${ext}` }))
}

/** First readable lines of a Markdown/text file, with light syntax stripped. */
async function renderTextOpening (file: FileRec): Promise<string[] | null> {
  const cached = textCache.get(file.id)
  if (cached) return cached
  const raw = await window.cs.readText(file.path)
  if (!raw.trim()) return null
  const lines = raw
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, '')
        .replace(/^>\s*/, '')
        .replace(/^[-*+]\s+/, '· ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*`]/g, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 9)
  textCache.set(file.id, lines)
  return lines
}

export function FilePreview ({ file, width = 180, className = '', fill = false }: {
  file: FileRec
  width?: number
  className?: string
  /** Let CSS own the box (full-bleed previews); width only sets render resolution. */
  fill?: boolean
}) {
  const [src, setSrc] = useState<string | null>(() => cache.get(keyOf(file, width)) ?? null)
  const [lines, setLines] = useState<string[] | null>(() => textCache.get(file.id) ?? null)

  useEffect(() => {
    if (file.kind === 'md') {
      setSrc(null)
      const hit = textCache.get(file.id)
      if (hit) {
        setLines(hit)
        return
      }
      let cancelled = false
      void (async () => {
        try {
          const next = await renderTextOpening(file)
          if (next && !cancelled) setLines(next)
        } catch {
          // Fall back to the type label.
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (file.kind !== 'pdf' && file.kind !== 'image') {
      setSrc(null)
      return
    }
    const key = keyOf(file, width)
    const hit = cache.get(key)
    if (hit) {
      setSrc(hit)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const next = file.kind === 'pdf' ? await renderPdfThumb(file, width) : await renderImageThumb(file)
        if (!next) return
        cache.set(key, next)
        if (!cancelled) setSrc(next)
      } catch {
        // The type label is the fallback; a broken file should not throw here.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file.id, file.path, file.hash, file.kind, width])

  const showText = file.kind === 'md' && lines && lines.length > 0

  return (
    <div className={`file-preview ${showText ? 'is-text' : ''} ${className}`.trim()} style={fill ? undefined : { width }}>
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : showText ? (
        <div className="file-preview-text" aria-hidden="true">
          {lines.slice(0, 8).map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : (
        <div className="file-preview-fallback" aria-hidden="true">
          <TypeBadge kind={file.kind} ext={file.ext} />
        </div>
      )}
    </div>
  )
}
