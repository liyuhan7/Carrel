import { useStore } from '../store'
import { NoteEditor } from './NoteEditor'
// >>> integration:note-capture-editing
import { NoteModuleHost, NoteTabs } from '../notes/NoteModuleHost'
import { useNoteUi } from '../notes/ui'
// <<< integration:note-capture-editing

export function NotePane ({ collapsed, onExpand, onCollapse }: {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}) {
  const notes = useStore((s) => s.notes)
  const activeNoteId = useStore((s) => s.workspace.activeNoteId)
  const createNote = useStore((s) => s.createNote)

  const note = notes.find((item) => item.id === activeNoteId) ?? notes[0]

  if (collapsed) {
    return (
      <>
        {/* >>> integration:note-capture-editing */}
        <NoteModuleHost />
        {/* <<< integration:note-capture-editing */}
        <button type="button" className="pane-rail" onClick={onExpand} title="展开笔记">
          <span>个人笔记</span>
        </button>
      </>
    )
  }

  return (
    <section className="pane note-pane">
      {/* >>> integration:note-capture-editing */}
      <NoteModuleHost />
      <NoteTabs
        trailing={
          <>
            <button
              type="button"
              className="icon-btn"
              title="切换笔记（Ctrl+K）"
              onClick={() => useNoteUi.getState().openSwitcher()}
            >
              ⌕
            </button>
            <button type="button" className="icon-btn" title="收起笔记区" onClick={onCollapse}>
              ›
            </button>
          </>
        }
      />
      {/* <<< integration:note-capture-editing */}

      {note ? (
        <NoteEditor note={note} variant="pane" />
      ) : (
        <div className="doc-empty">
          <p>还没有笔记。</p>
          <button type="button" className="btn btn-small" onClick={() => createNote()}>
            新建笔记
          </button>
        </div>
      )}
    </section>
  )
}
