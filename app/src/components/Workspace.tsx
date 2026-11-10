import { useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useStore } from '../store'
import { ReaderPane } from './ReaderPane'
import { AiPane } from './AiPane'
import { NotePane } from './NotePane'

export function Workspace () {
  const workspace = useStore((s) => s.workspace)
  const files = useStore((s) => s.files)
  const courses = useStore((s) => s.courses)
  const openCourse = useStore((s) => s.openCourse)
  const setView = useStore((s) => s.setView)
  const saveStatus = useStore((s) => s.saveStatus)
  const importDialog = useStore((s) => s.importDialog)

  const file = files.find((f) => f.id === workspace.activeTab)
  const course = courses.find((item) => item.id === file?.courseId)
  const page = file ? workspace.pages[file.id] ?? 1 : 0

  const readerRef = useRef<ImperativePanelHandle>(null)
  const aiRef = useRef<ImperativePanelHandle>(null)
  const notesRef = useRef<ImperativePanelHandle>(null)
  const [collapsed, setCollapsed] = useState({ reader: false, ai: false, notes: false })

  const resetLayout = () => {
    readerRef.current?.resize(46)
    aiRef.current?.resize(28)
    notesRef.current?.resize(26)
    readerRef.current?.expand()
    aiRef.current?.expand()
    notesRef.current?.expand()
  }

  return (
    <div className="workspace">
      <div className="ws-head">
        <div className="ws-path">
          <button type="button" className="ws-crumb" onClick={() => setView('courses')}>课程</button>
          {file ? (
            <>
              <span className="ws-sep">/</span>
              <button type="button" className="ws-crumb" onClick={() => openCourse(file.courseId)}>
                {course?.name ?? '未归类'}
              </button>
              <span className="ws-sep">/</span>
              <span className="ws-file">{file.name}</span>
              <span className="ws-page">
                第 {page} 页，共 {file.pageCount || 1} 页
              </span>
            </>
          ) : (
            <span className="ws-page">没有打开的资料</span>
          )}
        </div>
        <div className="ws-actions">
          {saveStatus !== 'saved' ? (
            <span className={`save-state is-${saveStatus}`}>
              {saveStatus === 'saving' ? '保存中…' : '保存失败'}
            </span>
          ) : null}
          <button type="button" className="btn btn-ghost btn-small" onClick={resetLayout}>
            重置布局
          </button>
          <button type="button" className="btn btn-small" onClick={() => void importDialog()}>
            导入资料
          </button>
        </div>
      </div>

      <PanelGroup direction="horizontal" autoSaveId="carrel-workspace" className="panes">
        <Panel
          ref={readerRef}
          defaultSize={46}
          minSize={18}
          collapsible
          collapsedSize={2.4}
          onCollapse={() => setCollapsed((value) => ({ ...value, reader: true }))}
          onExpand={() => setCollapsed((value) => ({ ...value, reader: false }))}
        >
          <ReaderPane collapsed={collapsed.reader} onExpand={() => readerRef.current?.expand()} onCollapse={() => readerRef.current?.collapse()} />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel
          ref={aiRef}
          defaultSize={28}
          minSize={18}
          collapsible
          collapsedSize={2.4}
          onCollapse={() => setCollapsed((value) => ({ ...value, ai: true }))}
          onExpand={() => setCollapsed((value) => ({ ...value, ai: false }))}
        >
          <AiPane collapsed={collapsed.ai} onExpand={() => aiRef.current?.expand()} onCollapse={() => aiRef.current?.collapse()} />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel
          ref={notesRef}
          defaultSize={26}
          minSize={18}
          collapsible
          collapsedSize={2.4}
          onCollapse={() => setCollapsed((value) => ({ ...value, notes: true }))}
          onExpand={() => setCollapsed((value) => ({ ...value, notes: false }))}
        >
          <NotePane collapsed={collapsed.notes} onExpand={() => notesRef.current?.expand()} onCollapse={() => notesRef.current?.collapse()} />
        </Panel>
      </PanelGroup>
    </div>
  )
}
