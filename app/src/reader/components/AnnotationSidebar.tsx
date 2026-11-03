// Annotation sidebar: every annotation of the current document plus the links
// the user actually created. The two tabs are different things and stay apart.

import { useState } from 'react'
import type { Anchor, ContentLink, LinkRelation, Resource, ResolveStatus } from '../../shared/contracts/content'
import type {
  AnnotationKind,
  AnnotationStyle,
  ResolvedAnnotation
} from '../../shared/contracts/reader'
import { STATUS_HINT, STATUS_LABEL, isRenderableStatus } from '../annotationResolve'

export const KIND_LABEL: Record<AnnotationKind, string> = {
  highlight: '高亮',
  underline: '下划线',
  strikethrough: '删除线',
  note: '批注',
  rect: '矩形',
  ellipse: '椭圆',
  arrow: '箭头',
  ink: '手写'
}

export const STATUS_TONE: Record<ResolveStatus, string> = {
  ok: 'ok',
  relocated: 'warn',
  ambiguous: 'warn',
  orphaned: 'bad',
  unlocatable: 'bad',
  missing: 'bad'
}

const RELATION_LABEL: Record<LinkRelation, string> = {
  asks_about: '向 AI 提问',
  quotes: '引用原文',
  cites: '引用',
  references: '参考',
  derived_from: '整理自',
  related_to: '相关'
}

const RESOURCE_LABEL: Record<Resource['kind'], string> = {
  document: '资料',
  note: '笔记',
  conversation: '对话'
}

const PALETTE = ['#d9c48f', '#5f6f79', '#6d8272', '#a4685c', '#8a7ba6']

interface SidebarProps {
  resourceId: string
  resolved: ResolvedAnnotation[]
  links: ContentLink[]
  anchors: Record<string, Anchor>
  resources: Record<string, Resource>
  onJump: (item: ResolvedAnnotation) => void
  onUpdate: (annotationId: string, changes: { body?: string; style?: AnnotationStyle }) => Promise<void>
  onRemove: (annotationId: string) => Promise<void>
  onAsk: (item: ResolvedAnnotation) => void
  onAddToNote: (item: ResolvedAnnotation) => void
  onNavigateLink: (linkId: string) => void
}

function summaryOf (item: ResolvedAnnotation): string {
  const annotation = item.annotation
  if (annotation.kind === 'note') return annotation.body || '（空批注）'
  if (annotation.body) return annotation.body
  return item.rects?.length ? `${KIND_LABEL[annotation.kind]} · ${item.rects.length} 行` : KIND_LABEL[annotation.kind]
}

function sortItems (items: ResolvedAnnotation[]): ResolvedAnnotation[] {
  return [...items].sort((a, b) => {
    const pageA = a.page ?? Number.MAX_SAFE_INTEGER
    const pageB = b.page ?? Number.MAX_SAFE_INTEGER
    if (pageA !== pageB) return pageA - pageB
    return a.annotation.createdAt - b.annotation.createdAt
  })
}

export function AnnotationSidebar ({
  resourceId,
  resolved,
  links,
  anchors,
  resources,
  onJump,
  onUpdate,
  onRemove,
  onAsk,
  onAddToNote,
  onNavigateLink
}: SidebarProps) {
  const [tab, setTab] = useState<'annotations' | 'links'>('annotations')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bodyDraft, setBodyDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const sorted = sortItems(resolved)

  const startEdit = (item: ResolvedAnnotation) => {
    setEditingId(item.annotation.id)
    setBodyDraft(item.annotation.body ?? '')
  }

  const saveEdit = async (item: ResolvedAnnotation) => {
    setSaving(true)
    try {
      await onUpdate(item.annotation.id, { body: bodyDraft })
      setEditingId(null)
    } catch {
      // The store surfaces the validation message; keep the editor open.
    } finally {
      setSaving(false)
    }
  }

  const linkRows = links
    .map((link) => {
      const from = anchors[link.fromAnchorId]
      const to = anchors[link.toAnchorId]
      const outgoing = Boolean(from && from.resourceId === resourceId)
      const other = outgoing ? to : from
      const otherResource = other ? resources[other.resourceId] : undefined
      return { link, other, otherResource, outgoing }
    })
    .sort((a, b) => b.link.createdAt - a.link.createdAt)

  return (
    <aside className="ann-sidebar">
      <div className="ann-tabs" role="tablist" aria-label="标注与关联内容">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'annotations'}
          className={tab === 'annotations' ? 'is-active' : ''}
          onClick={() => setTab('annotations')}
        >
          标注 <span className="ann-tab-count">{sorted.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'links'}
          className={tab === 'links' ? 'is-active' : ''}
          onClick={() => setTab('links')}
        >
          关联内容 <span className="ann-tab-count">{linkRows.length}</span>
        </button>
      </div>

      {tab === 'annotations' ? (
        <div className="ann-list" role="list">
          {sorted.length === 0 ? (
            <p className="ann-empty">
              选中正文后用工具栏的「高亮 / 下划线 / 批注」创建标注。标注只保存在本地，不会自动生成来源链接。
            </p>
          ) : (
            sorted.map((item) => {
              const annotation = item.annotation
              const editing = editingId === annotation.id
              return (
                <div className="ann-item" key={annotation.id} role="listitem">
                  <button type="button" className="ann-main" onClick={() => onJump(item)} title="跳转到原文">
                    <span className="ann-line">
                      <span className="ann-swatch" style={{ background: annotation.style.color }} />
                      <span className="ann-kind">{KIND_LABEL[annotation.kind]}</span>
                      {item.page ? <span className="ann-page">第 {item.page} 页</span> : null}
                      <span className={`ann-status is-${STATUS_TONE[item.status]}`} title={STATUS_HINT[item.status]}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </span>
                    <span className="ann-summary">{summaryOf(item)}</span>
                    {!isRenderableStatus(item.status) ? (
                      <span className="ann-hint">{STATUS_HINT[item.status]}</span>
                    ) : null}
                  </button>

                  {editing ? (
                    <div className="ann-editor">
                      <textarea
                        value={bodyDraft}
                        rows={3}
                        autoFocus
                        placeholder={annotation.kind === 'note' ? '批注正文（必填）' : '添加批注（可选）'}
                        onChange={(event) => setBodyDraft(event.target.value)}
                      />
                      <div className="ann-editor-row">
                        {PALETTE.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`ann-color${annotation.style.color === color ? ' is-active' : ''}`}
                            style={{ background: color }}
                            aria-label={`颜色 ${color}`}
                            onClick={() => {
                              void onUpdate(annotation.id, { style: { ...annotation.style, color } }).catch(() => undefined)
                            }}
                          />
                        ))}
                        <span className="tool-spacer" />
                        <button type="button" className="btn btn-small" onClick={() => setEditingId(null)}>
                          取消
                        </button>
                        <button type="button" className="btn btn-primary btn-small" disabled={saving} onClick={() => void saveEdit(item)}>
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ann-actions">
                      <button type="button" className="link" onClick={() => startEdit(item)}>
                        编辑
                      </button>
                      <button type="button" className="link" onClick={() => onAsk(item)}>
                        向 AI 提问
                      </button>
                      <button type="button" className="link" onClick={() => onAddToNote(item)}>
                        整理到笔记
                      </button>
                      <button type="button" className="link is-danger" onClick={() => void onRemove(annotation.id)}>
                        删除
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      ) : (
        <div className="ann-list" role="list">
          {linkRows.length === 0 ? (
            <p className="ann-empty">
              还没有关联内容。只有实际发送带选区的提问、或从笔记引用原文时才会建立来源关系；高亮本身不会自动生成链接。
            </p>
          ) : (
            linkRows.map(({ link, other, otherResource, outgoing }) => (
              <button
                key={link.id}
                type="button"
                className="ann-link"
                onClick={() => onNavigateLink(link.id)}
                title="打开关联来源"
              >
                <span className="ann-line">
                  <span className={`ann-link-dir is-${outgoing ? 'out' : 'in'}`}>{outgoing ? '→' : '←'}</span>
                  <span className="ann-kind">{RELATION_LABEL[link.relation]}</span>
                  <span className="ann-status is-ok">{link.createdBy === 'user' ? '用户建立' : '系统建立'}</span>
                </span>
                <span className="ann-summary">
                  {otherResource ? `${RESOURCE_LABEL[otherResource.kind]} · ${otherResource.title || otherResource.sourceId}` : '来源不可用'}
                </span>
                <span className="ann-hint">{new Date(link.createdAt).toLocaleString('zh-CN')}</span>
              </button>
            ))
          )}
        </div>
      )}
    </aside>
  )
}
