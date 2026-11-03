// Reader toolbar: active tool, colour, annotation visibility, filters and undo.

import { useState } from 'react'
import type { ResolveStatus } from '../../shared/contracts/content'
import type { AnnotationKind } from '../../shared/contracts/reader'
import type { AnnotationFilters } from './AnnotationOverlay'
import { KIND_LABEL } from './AnnotationSidebar'

export type ReaderTool = 'select' | AnnotationKind

const TOOLS: Array<{ tool: ReaderTool; label: string; title: string }> = [
  { tool: 'select', label: '选择', title: '选择文字或点击标注' },
  { tool: 'highlight', label: '高亮', title: '选中文字后直接高亮' },
  { tool: 'underline', label: '下划线', title: '选中文字后添加下划线' },
  { tool: 'strikethrough', label: '删除线', title: '选中文字后添加删除线' },
  { tool: 'note', label: '批注', title: '选中文字或点击页面位置添加批注' },
  { tool: 'rect', label: '矩形', title: '在页面上拖出矩形' },
  { tool: 'ellipse', label: '椭圆', title: '在页面上拖出椭圆' },
  { tool: 'arrow', label: '箭头', title: '从起点拖到终点' },
  { tool: 'ink', label: '手写', title: '按住指针自由绘制' }
]

const PALETTE = ['#d9c48f', '#5f6f79', '#6d8272', '#a4685c', '#8a7ba6']

const STATUS_OPTIONS: ResolveStatus[] = ['ok', 'relocated', 'ambiguous', 'orphaned', 'unlocatable', 'missing']
const STATUS_LABEL: Record<ResolveStatus, string> = {
  ok: '正常',
  relocated: '已重定位',
  ambiguous: '不唯一',
  orphaned: '原文不存在',
  unlocatable: '无法定位',
  missing: '来源缺失'
}
const KINDS: AnnotationKind[] = ['highlight', 'underline', 'strikethrough', 'note', 'rect', 'ellipse', 'arrow', 'ink']

function toggle<T> (list: T[], value: T, all: T[]): T[] {
  const next = list.length === 0
    ? all.filter((item) => item !== value)
    : list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value]
  return next.length === all.length ? [] : next
}

interface ToolbarProps {
  tool: ReaderTool
  onTool: (tool: ReaderTool) => void
  color: string
  onColor: (color: string) => void
  showAnnotations: boolean
  onToggleAnnotations: (visible: boolean) => void
  canUndo: boolean
  undoLabel: string | null
  onUndo: () => void
  filters: AnnotationFilters
  onFilters: (filters: AnnotationFilters) => void
}

export function ReaderToolbar ({
  tool,
  onTool,
  color,
  onColor,
  showAnnotations,
  onToggleAnnotations,
  canUndo,
  undoLabel,
  onUndo,
  filters,
  onFilters
}: ToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)

  return (
    <div className="reader-toolbar">
      <div className="reader-toolbar-row">
        <div className="tool-group" role="group" aria-label="标注工具">
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              className={`tool reader-tool${tool === item.tool ? ' is-active' : ''}`}
              aria-pressed={tool === item.tool}
              title={item.title}
              onClick={() => onTool(item.tool)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <span className="tool-sep" />

        <div className="tool-group" role="group" aria-label="标注颜色">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`ann-color${color === swatch ? ' is-active' : ''}`}
              style={{ background: swatch }}
              aria-label={`颜色 ${swatch}`}
              aria-pressed={color === swatch}
              onClick={() => onColor(swatch)}
            />
          ))}
        </div>

        <span className="tool-spacer" />

        <button
          type="button"
          className={`tool reader-tool${showAnnotations ? ' is-active' : ''}`}
          aria-pressed={showAnnotations}
          title={showAnnotations ? '隐藏所有标注' : '显示所有标注'}
          onClick={() => onToggleAnnotations(!showAnnotations)}
        >
          {showAnnotations ? '隐藏标注' : '显示标注'}
        </button>
        <button
          type="button"
          className={`tool reader-tool${filtersOpen ? ' is-active' : ''}`}
          aria-expanded={filtersOpen}
          title="按类型、颜色或定位状态筛选"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          筛选
        </button>
        <button
          type="button"
          className="tool reader-tool"
          disabled={!canUndo}
          title={undoLabel ? `撤销：${undoLabel}` : '没有可撤销的标注操作'}
          onClick={onUndo}
        >
          ↶ 撤销
        </button>
      </div>

      {filtersOpen ? (
        <div className="reader-filter-panel">
          <div className="filter-group">
            <span className="filter-label">类型</span>
            {KINDS.map((kind) => (
              <label key={kind} className="filter-check">
                <input
                  type="checkbox"
                  checked={filters.kinds.length === 0 || filters.kinds.includes(kind)}
                  onChange={() => onFilters({ ...filters, kinds: toggle(filters.kinds, kind, KINDS) })}
                />
                {KIND_LABEL[kind]}
              </label>
            ))}
          </div>
          <div className="filter-group">
            <span className="filter-label">状态</span>
            {STATUS_OPTIONS.map((status) => (
              <label key={status} className="filter-check">
                <input
                  type="checkbox"
                  checked={filters.statuses.length === 0 || filters.statuses.includes(status)}
                  onChange={() => onFilters({ ...filters, statuses: toggle(filters.statuses, status, STATUS_OPTIONS) })}
                />
                {STATUS_LABEL[status]}
              </label>
            ))}
          </div>
          <div className="filter-group">
            <span className="filter-label">颜色</span>
            {PALETTE.map((swatch) => (
              <label key={swatch} className="filter-check">
                <input
                  type="checkbox"
                  checked={filters.colors.length === 0 || filters.colors.includes(swatch)}
                  onChange={() => onFilters({ ...filters, colors: toggle(filters.colors, swatch, PALETTE) })}
                />
                <span className="ann-color" style={{ background: swatch }} />
              </label>
            ))}
            <button
              type="button"
              className="link"
              onClick={() => onFilters({ kinds: [], colors: [], statuses: [] })}
            >
              清除筛选
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
