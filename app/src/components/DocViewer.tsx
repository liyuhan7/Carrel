import { useEffect, useState } from 'react'
import { textCache, useStore } from '../store'
import { renderNote } from '../lib/markdown'
import type { FileRec } from '../types'

export function DocViewer ({ file, zoom }: { file: FileRec; zoom: number }) {
  if (file.kind === 'image') return <ImageViewer file={file} zoom={zoom} />
  if (file.kind === 'md') return <MarkdownViewer file={file} />
  return <Unsupported file={file} />
}

function ImageViewer ({ file, zoom }: { file: FileRec; zoom: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | undefined
    let cancelled = false
    ;(async () => {
      try {
        const bytes = await window.cs.readBytes(file.path)
        objectUrl = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer]))
        if (!cancelled) setUrl(objectUrl)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id, file.path])

  if (error) return <div className="doc-error">{error}</div>
  if (!url) return <div className="doc-loading">正在打开图片…</div>
  return (
    <div className="image-stage">
      <img src={url} alt={file.name} style={{ width: `${Math.round(zoom * 100)}%` }} />
    </div>
  )
}

function MarkdownViewer ({ file }: { file: FileRec }) {
  const text = textCache.get(file.id)?.[0] ?? ''
  return (
    <div className="md-stage">
      <article className="md-page" dangerouslySetInnerHTML={{ __html: renderNote(text || '_没有可显示的内容_') }} />
    </div>
  )
}

function Unsupported ({ file }: { file: FileRec }) {
  const revealFile = useStore((s) => s.revealFile)
  return (
    <div className="doc-empty">
      <h2>{file.name}</h2>
      <p>首版只渲染 PDF、Markdown 和图片。{file.ext.toUpperCase()} 的版面保真需要外部排版引擎，安排在后续版本。</p>
      <button type="button" className="btn" onClick={() => revealFile(file.id)}>
        在文件夹中显示
      </button>
    </div>
  )
}
