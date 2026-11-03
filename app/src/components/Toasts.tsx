import { useStore } from '../store'

export function Toasts () {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.tone === 'error' ? ' is-error' : ''}`}>
          {toast.text}
        </div>
      ))}
    </div>
  )
}
