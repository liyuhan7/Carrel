// Source link presentation: resolve a `csref:` id to a status and a label.
// Links are never re-pointed automatically; a broken source keeps its excerpt.

import type { Anchor, ContentLink, Resource } from '../shared/contracts/content'

export type SourceStatus = 'ok' | 'relocated' | 'missing' | 'deleted' | 'orphaned' | 'legacy'

export interface SourceView {
  linkId: string
  status: SourceStatus
  label: string
  title: string
  /** Present when the id belongs to a persisted ContentLink. */
  link?: ContentLink
  anchor?: Anchor
  resource?: Resource
}

export interface SourceStatusInput {
  links: Record<string, ContentLink>
  anchors: Record<string, Anchor>
  resources: Record<string, Resource>
  notes: Array<{ id: string }>
  files: Array<{ id: string; missing?: boolean }>
  refs: Array<{ id: string; fileId: string; page: number; quote: string; label: string }>
}

const STATUS_LABEL: Record<SourceStatus, string> = {
  ok: '来源正常',
  relocated: '来源已重定位',
  missing: '来源文件缺失',
  deleted: '来源已删除',
  orphaned: '来源无法定位',
  legacy: '旧来源'
}

export function statusLabel (status: SourceStatus): string {
  return STATUS_LABEL[status]
}

export function sourceStatus (linkId: string, input: SourceStatusInput): SourceView {
  const link = input.links[linkId]
  if (!link) {
    // Legacy `NoteRef` ids live in the note itself; keep them readable.
    const ref = input.refs.find((item) => item.id === linkId)
    if (ref) {
      const file = input.files.find((item) => item.id === ref.fileId)
      const status: SourceStatus = !file ? 'deleted' : file.missing ? 'missing' : 'legacy'
      return {
        linkId,
        status,
        label: ref.label,
        title: `${statusLabel(status)}：${ref.label}`
      }
    }
    return {
      linkId,
      status: 'orphaned',
      label: '来源无法定位',
      title: '这条来源记录不存在，正文摘录已保留'
    }
  }

  const anchor = input.anchors[link.toAnchorId]
  if (!anchor) {
    return { linkId, status: 'orphaned', label: '来源无法定位', title: '来源锚点缺失，正文摘录已保留', link }
  }
  const resource = input.resources[anchor.resourceId]
  if (!resource) {
    return { linkId, status: 'missing', label: '来源文件缺失', title: '来源资源不存在，正文摘录已保留', link, anchor }
  }
  if (resource.availability === 'missing') {
    return { linkId, status: 'missing', label: '来源文件缺失', title: '原始文件已不在原位置，正文摘录已保留', link, anchor, resource }
  }
  if (resource.availability === 'deleted' || (resource.kind === 'note' && !input.notes.some((note) => note.id === resource.sourceId))) {
    return { linkId, status: 'deleted', label: '来源已删除', title: '来源笔记已删除，正文摘录已保留', link, anchor, resource }
  }
  const relocated = anchor.accepted.revision !== anchor.origin.revision
  const label = sourceName(resource, anchor)
  return {
    linkId,
    status: relocated ? 'relocated' : 'ok',
    label,
    title: relocated ? `${label}（来源已重定位，点击按新位置打开）` : label,
    link,
    anchor,
    resource
  }
}

function sourceName (resource: Resource, anchor: Anchor): string {
  const selector = anchor.accepted.selector
  if (selector.type === 'document-text') return `${resource.title} · 第 ${selector.page} 页`
  if (selector.type === 'document-region') return `${resource.title} · 第 ${selector.page} 页`
  if (selector.type === 'message') return `${resource.title} · 回答`
  return resource.title
}
