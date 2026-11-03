import { useEffect, useState } from 'react'
import { useStore } from './store'
import { TopBar } from './components/TopBar'
import { HomePage } from './components/HomePage'
import { LibraryPage } from './components/LibraryPage'
import { NotesPage } from './components/NotesPage'
import { Workspace } from './components/Workspace'
import { SettingsModal } from './components/SettingsModal'
import { Toasts } from './components/Toasts'
// >>> integration:unified-content-index
import { SearchPanel } from './index/SearchPanel'
import { useIndexRuntime } from './index/runtime'
// <<< integration:unified-content-index

export default function App () {
  const hydrated = useStore((s) => s.hydrated)
  const view = useStore((s) => s.view)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const [dragging, setDragging] = useState(false)
  // >>> integration:unified-content-index
  useIndexRuntime()
  // <<< integration:unified-content-index

  useEffect(() => {
    void useStore.getState().hydrate()
    const off = window.cs.onAI((event) => useStore.getState().handleAIEvent(event))
    window.cs.onFlush(async () => {
      await (globalThis as unknown as { __csFlush?: () => Promise<void> }).__csFlush?.()
      window.cs.flushed()
    })
    return off
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const state = useStore.getState()
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void window.cs.pickFiles().then((paths) => state.importPaths(paths))
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (!state.workspace.activeTab) {
          state.notify('先打开一份资料', 'error')
          return
        }
        if (state.view !== 'workspace') state.setView('workspace')
        state.focusComposer()
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void (globalThis as unknown as { __csFlush?: () => Promise<void> }).__csFlush?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!hydrated) return <div className="boot">正在打开学习空间…</div>

  return (
    <div
      className={`app${dragging ? ' is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const paths = Array.from(event.dataTransfer.files).map((file) => window.cs.pathForFile(file)).filter(Boolean)
        if (paths.length) void useStore.getState().importPaths(paths)
      }}
    >
      <TopBar />
      <main className="view">
        {view === 'home' && <HomePage />}
        {view === 'workspace' && <Workspace />}
        {view === 'library' && <LibraryPage />}
        {view === 'notes' && <NotesPage />}
      </main>
      {dragging && <div className="drop-hint">松开即可导入</div>}
      {settingsOpen && <SettingsModal />}
      {/* >>> integration:unified-content-index */}
      <SearchPanel />
      {/* <<< integration:unified-content-index */}
      <Toasts />
    </div>
  )
}
