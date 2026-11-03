// Unified content search: one panel over documents, the AI conversation and
// notes. Results are grouped by resource kind; Enter opens the hit through the
// shared navigation path.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResourceKind, SearchResult } from '../shared/contracts/content'
import { useStore } from '../store'
import { getIndexRuntime, openSearchResult } from './runtime.ts'
import { useIndexUi } from './uiState.ts'
import { RESOURCE_KIND_LABEL } from './relations.ts'
import './index.css'

type Filter = 'all' | ResourceKind

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'document', label: '资料' },
  { id: 'conversation', label: '会话' },
  { id: 'note', label: '笔记' }
]

const GROUP_ORDER: ResourceKind[] = ['document', 'conversation', 'note']

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Snippet({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return <>{text}</>
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const lower = terms.map((term) => term.toLowerCase())
  return (
    <>
      {text.split(pattern).map((part, index) =>
        lower.includes(part.toLowerCase()) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
      )}
    </>
  )
}

function locatorText(result: SearchResult): string {
  const locator = result.locator
  if (locator.type === 'document-text') return `第 ${locator.page} 页`
  if (locator.type === 'document-region') return `第 ${locator.page} 页区域`
  if (locator.type === 'message') return '会话消息'
  if (locator.type === 'note-block') return '笔记内容块'
  return '整份内容'
}

export function SearchPanel() {
  const open = useIndexUi((state) => state.searchOpen)
  const closeSearch = useIndexUi((state) => state.closeSearch)
  const resources = useStore((state) => state.resources)
  const notify = useStore((state) => state.notify)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [results, setResults] = useState<SearchResult[]>([])
  const [incomplete, setIncomplete] = useState(0)
  const [failed, setFailed] = useState(0)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        useIndexUi.getState().openSearch()
        return
      }
      if (event.key === 'Escape' && useIndexUi.getState().searchOpen) {
        event.preventDefault()
        useIndexUi.getState().closeSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setActive(0)
    const focus = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(focus)
  }, [open])

  useEffect(() => {
    if (!open) return
    const runtime = getIndexRuntime()
    let cancelled = false
    const run = async () => {
      const text = query.trim()
      if (!text) {
        setResults([])
        setIncomplete(0)
        setFailed(0)
        setSearching(false)
        return
      }
      setSearching(true)
      const detail = await runtime.search.searchDetailed({
        text,
        resourceKinds: filter === 'all' ? undefined : [filter],
        limit: 60
      })
      if (cancelled) return
      setResults(detail.results)
      setIncomplete(detail.incompleteResourceIds.length)
      setFailed(detail.failedResourceIds.length)
      setActive(0)
      setSearching(false)
    }
    const timer = setTimeout(() => void run(), 120)
    const unsubscribe = runtime.subscribe(() => void run())
    return () => {
      cancelled = true
      clearTimeout(timer)
      unsubscribe()
    }
  }, [open, query, filter])

  const groups = useMemo(() => {
    return GROUP_ORDER.map((kind) => ({
      kind,
      items: results.filter((result) => resources[result.resourceId]?.kind === kind)
    })).filter((group) => group.items.length > 0)
  }, [results, resources])

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const row = list.querySelector<HTMLElement>(`[data-index="${active}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const openResult = async (result: SearchResult | undefined) => {
    if (!result) return
    try {
      await openSearchResult(result)
      closeSearch()
    } catch (error) {
      notify((error as Error).message, 'error')
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (flat.length ? Math.min(index + 1, flat.length - 1) : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void openResult(flat[active])
    }
  }

  return (
    <div className="search-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeSearch()
    }}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="统一内容检索">
        <div className="search-head">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索资料、会话与笔记…"
            aria-label="搜索内容"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="search-kbd">Esc</span>
        </div>

        <div className="search-filters" role="tablist" aria-label="按类型过滤">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`search-filter${filter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
          <span className="search-count">
            {searching ? '检索中…' : query.trim() ? `${results.length} 条结果` : null}
          </span>
        </div>

        <div className="search-results" ref={listRef}>
          {groups.map((group) => (
            <section key={group.kind} className="search-group">
              <h3 className="search-group-head">
                {RESOURCE_KIND_LABEL[group.kind]}
                <span className="search-group-count">{group.items.length}</span>
              </h3>
              <ul>
                {group.items.map((result) => {
                  const index = flat.indexOf(result)
                  const resource = resources[result.resourceId]
                  return (
                    <li key={result.unitId}>
                      <button
                        type="button"
                        data-index={index}
                        className={`search-row${index === active ? ' is-active' : ''}`}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => void openResult(result)}
                      >
                        <span className="search-row-head">
                          <span className="search-row-title">{resource?.title ?? '未知来源'}</span>
                          <span className="search-row-locator">{locatorText(result)}</span>
                        </span>
                        <span className="search-row-snippet">
                          <Snippet text={result.snippet} query={query} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          {query.trim() && !searching && !results.length ? (
            <p className="search-hint">没有匹配的内容。</p>
          ) : null}
          {incomplete > 0 ? (
            <p className="search-hint is-warn">
              {failed > 0 ? `${failed} 份内容索引失败，` : ''}
              还有 {incomplete} 份内容尚未索引完成，结果可能不完整。
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
