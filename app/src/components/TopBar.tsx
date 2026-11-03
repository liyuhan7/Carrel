import { useStore } from '../store'

const ITEMS = [
  { id: 'home', label: '首页' },
  { id: 'workspace', label: '学习空间' },
  { id: 'library', label: '资料库' },
  { id: 'notes', label: '笔记' }
] as const

export function TopBar () {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const openSettings = useStore((s) => s.openSettings)

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M6 3.5h7.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6z" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6 3.5v13" stroke="var(--evidence)" strokeWidth="2.6" />
          </svg>
        </span>
        <span className="brand-name">Carrel</span>
      </div>

      <nav className="nav" aria-label="主导航">
        {ITEMS.map((item) => (
          <button key={item.id} type="button" aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <button type="button" className="btn btn-ghost" onClick={() => openSettings()}>
          模型服务
        </button>
      </div>
    </header>
  )
}
