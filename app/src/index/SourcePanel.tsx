// Source and backlink surfaces for the reading and note modules.
// Every row reports the real resolve status; nothing is labelled "已验证" as a
// blanket claim. Relocated candidates can be adopted only by an explicit click.

import { useEffect, useMemo, useState } from 'react'
import type { ContentSelector, ResolveResult, ResolveStatus } from '../shared/contracts/content'
import { useStore } from '../store'
import { getIndexRuntime } from './runtime.ts'
import {
  RELATION_LABEL,
  RESOLVE_STATUS_LABEL,
  RESOURCE_KIND_LABEL,
  type RelationEntry
} from './relations.ts'
import { confirmAnchorRelocation } from './relocation.ts'
import { selectorLabel } from './selectors.ts'
import './index.css'

export function SourceStatusBadge({ status }: { status: ResolveStatus }) {
  return <span className={`src-status is-${status}`}>{RESOLVE_STATUS_LABEL[status]}</span>
}

function useResolved(anchorIds: string[]): Record<string, ResolveResult> {
  const anchors = useStore((state) => state.anchors)
  const resources = useStore((state) => state.resources)
  const [results, setResults] = useState<Record<string, ResolveResult>>({})
  const key = anchorIds.join('|')

  useEffect(() => {
    let cancelled = false
    const runtime = getIndexRuntime()
    void (async () => {
      const next: Record<string, ResolveResult> = {}
      for (const anchorId of anchorIds) {
        const anchor = anchors[anchorId]
        if (!anchor) continue
        next[anchorId] = await runtime.resolver.resolve(anchor)
      }
      if (!cancelled) setResults(next)
    })()
    return () => {
      cancelled = true
    }
  }, [key, anchors, resources])

  return results
}

function useEntries(anchorId?: string, resourceId?: string): RelationEntry[] {
  const anchors = useStore((state) => state.anchors)
  const links = useStore((state) => state.links)
  const resources = useStore((state) => state.resources)

  return useMemo(() => {
    const relations = getIndexRuntime().relations
    if (anchorId) return relations.entriesForAnchor(anchorId)
    if (resourceId) return relations.relatedContent(resourceId)
    return []
  }, [anchorId, resourceId, anchors, links, resources])
}

function navigateTo(anchorId: string): void {
  const state = useStore.getState()
  void state.navigation.navigateToAnchor(anchorId).catch((error: unknown) => {
    state.notify((error as Error).message, 'error')
  })
}

async function adoptPosition(anchorId: string, selector: ContentSelector): Promise<boolean> {
  const state = useStore.getState()
  const anchor = state.anchors[anchorId]
  const resource = anchor ? state.resources[anchor.resourceId] : undefined
  if (!anchor || !resource) {
    state.notify('来源已失效，无法更新位置', 'error')
    return false
  }
  try {
    await confirmAnchorRelocation({
      transactions: state.transactions,
      anchorId,
      selector,
      revision: resource.revision
    })
    state.notify('已更新来源位置')
    return true
  } catch (error) {
    state.notify((error as Error).message, 'error')
    return false
  }
}

function SourceRow({ entry, result }: { entry: RelationEntry; result: ResolveResult | undefined }) {
  const [busy, setBusy] = useState(false)
  const status: ResolveStatus = result?.status ?? 'missing'
  const resource = useStore((state) => state.resources[entry.otherResourceId])
  const title = entry.otherTitle ?? resource?.title ?? '未知来源'
  const relation = RELATION_LABEL[entry.relation]

  const adopt = async (selector: ContentSelector) => {
    setBusy(true)
    await adoptPosition(entry.otherAnchorId, selector)
    setBusy(false)
  }

  return (
    <li className="src-item">
      <button type="button" className="src-row" onClick={() => navigateTo(entry.otherAnchorId)}>
        <span className="src-row-head">
          <span className={`src-rel is-${entry.relation}`}>{relation}</span>
          <span className="src-title">{title}</span>
          <SourceStatusBadge status={status} />
        </span>
        {entry.snapshotText ? <span className="src-excerpt">{entry.snapshotText}</span> : null}
        <span className="src-meta">
          {entry.otherKind ? RESOURCE_KIND_LABEL[entry.otherKind] : '来源'}
          {result?.selector ? ` · ${selectorLabel(result.selector)}` : ''}
        </span>
      </button>

      {result?.status === 'relocated' && result.selector ? (
        <button
          type="button"
          className="src-action"
          disabled={busy}
          onClick={() => void adopt(result.selector as ContentSelector)}
        >
          采用新位置
        </button>
      ) : null}

      {result?.status === 'ambiguous' && result.candidates?.length ? (
        <div className="src-candidates">
          <span className="src-candidates-head">有 {result.candidates.length} 处可能位置：</span>
          {result.candidates.map((candidate, index) => (
            <button
              key={`${entry.otherAnchorId}-${index}`}
              type="button"
              className="src-action"
              disabled={busy}
              onClick={() => void adopt(candidate)}
            >
              {selectorLabel(candidate)}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  )
}

function SourceList({ entries }: { entries: RelationEntry[] }) {
  const results = useResolved(entries.map((entry) => entry.otherAnchorId))
  if (!entries.length) return <p className="src-empty">还没有建立来源关系</p>
  return (
    <ul className="src-list">
      {entries.map((entry) => (
        <SourceRow key={`${entry.link.id}-${entry.direction}`} entry={entry} result={results[entry.otherAnchorId]} />
      ))}
    </ul>
  )
}

/** Sources and backlinks of one anchor (a note block, a message, a quote). */
export function SourcePanel({ anchorId, title = '来源与反向链接' }: { anchorId: string; title?: string }) {
  const entries = useEntries(anchorId)
  return (
    <section className="src-panel" aria-label={title}>
      <h3 className="src-panel-head">
        {title}
        <span className="src-panel-count">{entries.length}</span>
      </h3>
      <SourceList entries={entries} />
    </section>
  )
}

/** Resource-level related content, grouped by the other resource kind. */
export function RelatedContentPanel({
  resourceId,
  title = '关联内容'
}: {
  resourceId: string
  title?: string
}) {
  const entries = useEntries(undefined, resourceId)
  const groups = useMemo(() => {
    const order: RelationEntry['otherKind'][] = ['document', 'conversation', 'note']
    return order
      .map((kind) => ({
        kind,
        items: entries.filter((entry) => entry.otherKind === kind)
      }))
      .filter((group) => group.items.length > 0)
  }, [entries])

  return (
    <section className="src-panel" aria-label={title}>
      <h3 className="src-panel-head">
        {title}
        <span className="src-panel-count">{entries.length}</span>
      </h3>
      {!entries.length ? <p className="src-empty">还没有关联内容</p> : null}
      {groups.map((group) => (
        <div key={group.kind ?? 'unknown'} className="src-group">
          <h4 className="src-group-head">
            {group.kind ? RESOURCE_KIND_LABEL[group.kind] : '其他'}
            <span className="src-panel-count">{group.items.length}</span>
          </h4>
          <SourceList entries={group.items} />
        </div>
      ))}
    </section>
  )
}
