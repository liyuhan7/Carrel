// Reader toolbar: the tools used on almost every page stay visible, the rest
// live in menus. Colour appears only while an annotation tool is active, and
// annotation management (visibility + filters) is one entry on the right.
// The left cluster wraps as a unit so a narrow pane never breaks a button.

import { useEffect, useRef, useState } from 'react'
import type { ResolveStatus } from '../../shared/contracts/content'
import type { AnnotationKind } from '../../shared/contracts/reader'
import type { AnnotationFilters } from './AnnotationOverlay'
import { KIND_LABEL } from './AnnotationSidebar'

export type ReaderTool = 'select' | AnnotationKind

interface ToolItem {
  tool: ReaderTool
  label: string
  title: string
}

const PRIMARY: ToolItem[] = [
  { tool: 'select', label: '选择', title: '选择文字或点击标注' },
  { tool: 'highlight', label: '高亮', title: '选中文字后直接高亮' },
  { tool: 'note', label: '批注', title: '选中文字或点击页面位置添加批注' }
]

const MARK_TOOLS: ToolItem[] = [
  { tool: 'underline', label: '下划线', title: '选中文字后添加下划线' },
  { tool: 'strikethrough', label: '删除线', title: '选中文字后添加删除线' }
]

const DRAW_TOOLS: ToolItem[] = [
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
  /** Hand tool: drag anywhere to pan a zoomed page instead of selecting. */
  pan: boolean
  onPan: (pan: boolean) => void
}

type OpenMenu = 'mark' | 'draw' | 'color' | 'manage' | null

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
  onFilters,
  pan,
  onPan
}: ToolbarProps) {
  const [menu, setMenu] = useState<OpenMenu>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const choose = (next: ReaderTool) => {
    onTool(next)
    if (pan) onPan(false)
    setMenu(null)
  }

  const activeMark = MARK_TOOLS.find((item) => item.tool === tool)
  const activeDraw = DRAW_TOOLS.find((item) => item.tool === tool)
  const filtersActive = filters.kinds.length > 0 || filters.colors.length > 0 || filters.statuses.length > 0

  return (
    <div className="reader-toolbar" ref={rootRef}>
      <div className="reader-toolbar-row">
        <div className="reader-toolbar-main">
          <div className="tool-group" role="group" aria-label="标注工具">
            <button
              type="button"
              className={`tool reader-tool${pan ? ' is-active' : ''}`}
              aria-pressed={pan}
              title="拖拽页面（也可以按住空格或中键拖动）"
              onClick={() => {
                if (pan) {
                  onPan(false)
                  return
                }
                onTool('select')
                setMenu(null)
                onPan(true)
              }}
            >
              拖拽
            </button>

            {PRIMARY.map((item) => (
              <button
                key={item.tool}
                type="button"
                // 拖拽和选择互斥：手型工具在用时，文字选择不再算激活。
                className={`tool reader-tool${tool === item.tool && !pan ? ' is-active' : ''}`}
                aria-pressed={tool === item.tool && !pan}
                title={item.title}
                onClick={() => choose(item.tool)}
              >
                {item.label}
              </button>
            ))}

            <div className="tool-menu">
              <button
                type="button"
                className={`tool reader-tool tool-menu-trigger${activeMark ? ' is-active' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu === 'mark'}
                title="下划线、删除线"
                onClick={() => setMenu(menu === 'mark' ? null : 'mark')}
              >
                {activeMark ? activeMark.label : '标记'}
                <span className="tool-caret" aria-hidden="true">▾</span>
              </button>
              {menu === 'mark' ? (
                <div className="tool-menu-panel" role="menu" aria-label="文字标记">
                  {MARK_TOOLS.map((item) => (
                    <button
                      key={item.tool}
                      type="button"
                      role="menuitemradio"
                      aria-checked={tool === item.tool}
                      className={`tool-menu-item${tool === item.tool ? ' is-active' : ''}`}
                      onClick={() => choose(item.tool)}
                    >
                      {item.label}
                      {tool === item.tool ? <span className="tool-menu-check">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="tool-menu">
              <button
                type="button"
                className={`tool reader-tool tool-menu-trigger${activeDraw ? ' is-active' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu === 'draw'}
                title="矩形、椭圆、箭头、手写"
                onClick={() => setMenu(menu === 'draw' ? null : 'draw')}
              >
                {activeDraw ? activeDraw.label : '绘图'}
                <span className="tool-caret" aria-hidden="true">▾</span>
              </button>
              {menu === 'draw' ? (
                <div className="tool-menu-panel" role="menu" aria-label="绘图">
                  {DRAW_TOOLS.map((item) => (
                    <button
                      key={item.tool}
                      type="button"
                      role="menuitemradio"
                      aria-checked={tool === item.tool}
                      className={`tool-menu-item${tool === item.tool ? ' is-active' : ''}`}
                      onClick={() => choose(item.tool)}
                    >
                      {item.label}
                      {tool === item.tool ? <span className="tool-menu-check">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {tool !== 'select' ? (
            <div className="tool-menu">
              <button
                type="button"
                className={`tool reader-tool color-trigger${menu === 'color' ? ' is-active' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu === 'color'}
                title="标注颜色"
                onClick={() => setMenu(menu === 'color' ? null : 'color')}
              >
                <span className="ann-color" style={{ background: color }} />
                <span className="tool-caret" aria-hidden="true">▾</span>
              </button>
              {menu === 'color' ? (
                <div className="tool-menu-panel color-panel is-right" role="menu" aria-label="标注颜色">
                  {PALETTE.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      role="menuitemradio"
                      aria-checked={color === swatch}
                      className={`ann-color${color === swatch ? ' is-active' : ''}`}
                      style={{ background: swatch }}
                      aria-label={`颜色 ${swatch}`}
                      onClick={() => {
                        onColor(swatch)
                        setMenu(null)
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="reader-toolbar-side">
          <button
            type="button"
            className="tool reader-tool"
            disabled={!canUndo}
            title={undoLabel ? `撤销：${undoLabel}` : '没有可撤销的标注操作'}
            onClick={onUndo}
          >
            ↶ 撤销
          </button>

          <div className="tool-menu">
            <button
              type="button"
              className={`tool reader-tool tool-menu-trigger${menu === 'manage' ? ' is-active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menu === 'manage'}
              title="显示、隐藏和筛选标注"
              onClick={() => setMenu(menu === 'manage' ? null : 'manage')}
            >
              标注管理
              {!showAnnotations || filtersActive ? <span className="tool-state-dot" aria-hidden="true" /> : null}
              <span className="tool-caret" aria-hidden="true">▾</span>
            </button>
            {menu === 'manage' ? (
              <div className="tool-menu-panel is-wide is-right" role="menu" aria-label="标注管理">
                <div className="tool-menu-title">标注管理</div>
                <label className="tool-menu-row">
                  <input
                    type="checkbox"
                    checked={showAnnotations}
                    onChange={(event) => onToggleAnnotations(event.target.checked)}
                  />
                  显示所有标注
                </label>

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
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
