import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Popover ({ trigger, children, align = 'left', width = 240 }: {
  trigger: (open: boolean) => ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className="popover-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {trigger(open)}
      </button>
      {open && (
        <div className={`popover popover-${align}`} style={{ width }} role="menu">
          {children}
        </div>
      )}
    </div>
  )
}
