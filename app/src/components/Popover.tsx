import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function Popover ({ trigger, children, align = 'left', width = 240, dismissOnClick = false }: {
  trigger: (open: boolean) => ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  width?: number
  /** Close after a click inside, except on inputs or elements marked data-keep-open. */
  dismissOnClick?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Flip above the trigger when the menu would fall outside the window; the
  // composer sits at the bottom edge, so a downward menu is otherwise clipped.
  useLayoutEffect(() => {
    if (!open) return
    const wrap = ref.current
    const menu = menuRef.current
    if (!wrap || !menu) return
    const rect = wrap.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    menu.classList.toggle('is-up', spaceBelow < menu.offsetHeight + 12 && spaceAbove > spaceBelow)
  }, [open])

  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className="popover-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {trigger(open)}
      </button>
      {open && (
        <div
          ref={menuRef}
          className={`popover popover-${align}`}
          style={{ width }}
          role="menu"
          onClick={(event) => {
            if (!dismissOnClick) return
            const target = event.target as HTMLElement
            if (target.closest('input, textarea, [data-keep-open]')) return
            // Defer so the row's own click handler runs before the menu unmounts.
            setTimeout(() => setOpen(false), 0)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
