// Page-one thumbnail for a library file. Rendered once per (file, width) and
// cached in memory; the placeholder stays if the file cannot be read.
import { useEffect, useState } from 'react'
import type { FileRec } from '../types'
import { TypeBadge } from './TypeBadge'
import { cachedPdf, loadPdf } from '../lib/pdf'

const cache = new Map<string, string>()

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
  const url = URL.createObjectURL(new Blob([buffer], { type: `image/${ext}` }))
  return url
}

export function PdfThumb ({ file, width = 180, className = '' }: {
  file: FileRec
  width?: number
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(() => cache.get(keyOf(file, width)) ?? null)

  useEffect(() => {
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
        // The placeholder is the fallback; a broken file should not throw here.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file.id, file.path, file.hash, file.kind, width])

  return (
    <div className={`pdf-thumb ${className}`.trim()} style={{ width }}>
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <div className="pdf-thumb-fallback" aria-hidden="true">
          <TypeBadge kind={file.kind} ext={file.ext} />
        </div>
      )}
    </div>
  )
}
