import { useStore } from '../store'
import { NoteEditor } from './NoteEditor'

export function NotePane ({ collapsed, onExpand, onCollapse }: {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}) {
  const notes = useStore((s) => s.notes)
  const activeNoteId = useStore((s) => s.workspace.activeNoteId)
  const createNote = useStore((s) => s.createNote)
  const selectNote = useStore((s) => s.selectNote)

  const note = notes.find((item) => item.id === activeNoteId) ?? notes[0]

  if (collapsed) {
    return (
      <button type="button" className="pane-rail" onClick={onExpand} title="展开笔记">
        <span>个人笔记</span>
      </button>
    )
  }

  return (
    <section className="pane note-pane">
      <div className="pane-head">
        <span className="pane-title">笔记</span>
        <select className="note-select" value={note?.id ?? ''} aria-label="切换笔记" onChange={(event) => selectNote(event.target.value)}>
          {notes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || '未命名笔记'}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" title="新建笔记" onClick={() => createNote()}>
          ＋
        </button>
        <span className="tool-spacer" />
        <button type="button" className="icon-btn" title="收起笔记区" onClick={onCollapse}>
          ›
        </button>
      </div>

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
