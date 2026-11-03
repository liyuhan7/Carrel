import { create } from 'zustand'
import type {
  Annotation, ChatMessage, FileKind, FileRec, Note, NoteRef,
  PersistedState, Provider, Rect, WorkspaceState
} from './types'
import { DEFAULT_PROVIDERS } from './types'
import { extractPageTexts, loadPdf } from './lib/pdf'
import { parseAnswer } from './lib/verify'
import { uid } from './lib/format'

export type View = 'home' | 'workspace' | 'library' | 'notes'

/** Extracted page text lives outside React state: it can be megabytes. */
export const textCache = new Map<string, string[]>()

interface Toast { id: string; text: string; tone: 'info' | 'error' }

interface Store extends PersistedState {
  hydrated: boolean
  view: View
  saveStatus: 'saved' | 'saving' | 'error'
  selection: { fileId: string; page: number; text: string } | null
  focusQuote: { fileId: string; page: number; quote: string; nonce: number } | null
  toasts: Toast[]
  streaming: { reqId: string; messageId: string } | null
  composerFocus: number
  settingsOpen: boolean
  settingsProvider: string | null

  hydrate: () => Promise<void>
  openSettings: (providerId?: string) => void
  closeSettings: () => void
  importDialog: () => Promise<void>
  setView: (view: View) => void
  notify: (text: string, tone?: 'info' | 'error') => void

  importPaths: (paths: string[]) => Promise<void>
  openFile: (id: string) => Promise<void>
  openFromLibrary: (id: string) => Promise<void>
  closeTab: (id: string) => void
  setPage: (fileId: string, page: number) => void
  setZoom: (zoom: number) => void
  setReaderPanel: (panel: 'doc' | 'ann') => void
  setContextScope: (scope: WorkspaceState['contextScope']) => void
  toggleFavorite: (id: string) => void
  removeFile: (id: string) => void
  revealFile: (id: string) => void

  setSelection: (selection: { fileId: string; page: number; text: string } | null) => void
  focusOn: (fileId: string, page: number, quote: string) => void
  addAnnotation: (fileId: string, page: number, rects: Rect[], text: string) => void
  removeAnnotation: (id: string) => void

  createNote: (title?: string) => string
  selectNote: (id: string) => void
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body'>>) => void
  deleteNote: (id: string) => void
  insertToNote: (noteId: string | null, markdown: string, refs?: Omit<NoteRef, 'id' | 'createdAt'>[]) => string
  insertSelectionToNote: () => void
  insertAnswerToNote: (messageId: string) => void

  setActiveProvider: (id: string) => void
  updateProvider: (id: string, patch: Partial<Provider>) => void
  saveKey: (id: string, key: string) => Promise<void>
  clearKey: (id: string) => Promise<void>

  sendQuestion: (question: string) => Promise<void>
  stopAnswer: () => void
  handleAIEvent: (event: { type: string; reqId: string; delta?: string; text?: string; message?: string; stopped?: boolean }) => void
  focusComposer: () => void
}

const SYSTEM_PROMPT = `你是 Carrel 的学习助手，服务对象是正在阅读课程资料的大学生。
规则：
1. 只依据用户消息里提供的资料内容作答；资料不足时直接说明缺少什么，不要编造。
2. 引用资料时，在对应句子末尾写 [[p页码]]，页码必须是资料中真实存在的页。
3. 回答结束后另起一行，为每处引用输出一行：@cite 页码 | 原文摘录
   原文摘录必须是资料原文中连续、逐字存在的 10 到 40 个字，不得改写、概括或翻译。
4. 用简体中文回答，先给结论再展开，数学表达用纯文本或简单 LaTeX。
5. 不要输出“引用清单”这类标题，@cite 行由应用解析。`

function kindOf (ext: string): FileKind {
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return 'md'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image'
  return 'other'
}

function starterNote (): Note {
  const now = Date.now()
  return {
    id: uid(),
    title: '开始记录',
    body: '## 怎么用\n\n- 在资料库导入 PDF，选中正文可以直接向 AI 提问。\n- 回答里的「第 8 页」可以点开，回到原文。\n- 选中内容点「加入笔记」，会在这里生成一条能回溯的引用。\n',
    refs: [],
    createdAt: now,
    updatedAt: now
  }
}

function snapshot (state: Store): PersistedState {
  return {
    files: state.files,
    notes: state.notes,
    annotations: state.annotations,
    messages: state.messages,
    providers: state.providers.map(({ hasKey: _hasKey, ...rest }) => rest),
    activeProviderId: state.activeProviderId,
    workspace: state.workspace
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<Store>((set, get) => {
  const persist = () => {
    set({ saveStatus: 'saving' })
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      try {
        await window.cs.saveState(snapshot(get()))
        set({ saveStatus: 'saved' })
      } catch {
        set({ saveStatus: 'error' })
      }
    }, 350)
  }

  const flush = async () => {
    clearTimeout(saveTimer)
    try {
      await window.cs.saveState(snapshot(get()))
      set({ saveStatus: 'saved' })
    } catch {
      set({ saveStatus: 'error' })
    }
  }
  ;(globalThis as unknown as { __csFlush: () => Promise<void> }).__csFlush = flush

  return {
    files: [],
    notes: [],
    annotations: [],
    messages: [],
    providers: DEFAULT_PROVIDERS,
    activeProviderId: 'demo',
    workspace: {
      tabs: [],
      activeTab: null,
      pages: {},
      zoom: 1,
      activeNoteId: null,
      contextScope: 'selection',
      readerPanel: 'doc'
    },
    hydrated: false,
    view: 'home',
    saveStatus: 'saved',
    selection: null,
    focusQuote: null,
    toasts: [],
    streaming: null,
    composerFocus: 0,
    settingsOpen: false,
    settingsProvider: null,

    openSettings: (providerId) => set({ settingsOpen: true, settingsProvider: providerId ?? get().activeProviderId }),
    closeSettings: () => set({ settingsOpen: false, settingsProvider: null }),
    importDialog: async () => {
      const paths = await window.cs.pickFiles()
      await get().importPaths(paths)
    },

    hydrate: async () => {
      const { state, keys } = await window.cs.getState()
      if (state && state.workspace) {
        const providers = state.providers?.length ? state.providers : DEFAULT_PROVIDERS
        const defaults: WorkspaceState = {
          tabs: [],
          activeTab: null,
          pages: {},
          zoom: 1,
          activeNoteId: null,
          contextScope: 'selection',
          readerPanel: 'doc'
        }
        set({
          ...state,
          workspace: { ...defaults, ...state.workspace },
          providers: providers.map((p) => ({ ...p, hasKey: Boolean(keys[p.id]) })),
          hydrated: true
        })
        if (state.files.length) {
          const missing = await window.cs.missing(state.files.map((f) => f.path))
          set((s) => ({ files: s.files.map((f) => ({ ...f, missing: Boolean(missing[f.path]) })) }))
        }
        // Restored tabs need their extracted text before AI context or citation checks can work.
        for (const id of state.workspace?.tabs ?? []) {
          if (textCache.has(id)) continue
          const pages = await window.cs.getText(id)
          if (pages) textCache.set(id, pages)
        }
      } else {
        const note = starterNote()
        set({
          providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, hasKey: false })),
          activeProviderId: 'demo',
          notes: [note],
          workspace: { tabs: [], activeTab: null, pages: {}, zoom: 1, activeNoteId: note.id, contextScope: 'selection', readerPanel: 'doc' },
          hydrated: true
        })
      }
    },

    setView: (view) => set({ view }),
    notify: (text, tone = 'info') => {
      const id = uid()
      set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2800)
    },

    importPaths: async (paths) => {
      if (!paths.length) return
      const opened: string[] = []
      for (const filePath of paths) {
        const existing = get().files.find((f) => f.path === filePath)
        if (existing) {
          opened.push(existing.id)
          continue
        }
        try {
          const info = await window.cs.probe(filePath)
          const kind = kindOf(info.ext)
          const rec: FileRec = {
            id: uid(),
            name: info.name,
            path: filePath,
            kind,
            ext: info.ext,
            size: info.size,
            mtime: info.mtime,
            hash: info.hash,
            addedAt: Date.now(),
            lastOpenedAt: Date.now(),
            pageCount: 0,
            favorite: false
          }
          if (kind === 'pdf') {
            get().notify(`正在解析 ${info.name}`)
            const bytes = await window.cs.readBytes(filePath)
            const doc = await loadPdf(rec.id, bytes)
            rec.pageCount = doc.numPages
            const pages = await extractPageTexts(doc)
            textCache.set(rec.id, pages)
            await window.cs.saveText(rec.id, pages)
          } else if (kind === 'md') {
            const text = await window.cs.readText(filePath)
            textCache.set(rec.id, [text])
            await window.cs.saveText(rec.id, [text])
          } else if (kind === 'other') {
            get().notify(`${info.name}：首版暂不支持该格式的版面渲染`, 'error')
          }
          set((s) => ({ files: [rec, ...s.files] }))
          opened.push(rec.id)
        } catch (err) {
          get().notify(`${filePath.split(/[\\/]/).pop()} 导入失败：${(err as Error).message}`, 'error')
        }
      }
      if (opened.length) {
        await get().openFile(opened[0])
        get().notify(opened.length > 1 ? `已导入 ${opened.length} 份资料` : '已导入资料')
      }
      persist()
    },

    openFile: async (id) => {
      const file = get().files.find((f) => f.id === id)
      if (!file) return
      if (file.missing) {
        get().notify('原始文件已不在原位置，无法打开', 'error')
        return
      }
      if (!textCache.has(id)) {
        const pages = await window.cs.getText(id)
        if (pages) textCache.set(id, pages)
      }
      set((s) => {
        const tabs = s.workspace.tabs.includes(id) ? s.workspace.tabs : [...s.workspace.tabs, id]
        return {
          view: 'workspace',
          workspace: {
            ...s.workspace,
            tabs,
            activeTab: id,
            pages: { ...s.workspace.pages, [id]: s.workspace.pages[id] ?? 1 }
          },
          files: s.files.map((f) => (f.id === id ? { ...f, lastOpenedAt: Date.now() } : f))
        }
      })
      persist()
    },

    openFromLibrary: async (id) => {
      const file = get().files.find((f) => f.id === id)
      if (!file) return
      try {
        const info = await window.cs.probe(file.path)
        if (info.hash !== file.hash) {
          set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, changed: true } : f)) }))
          get().notify('文件已在外部修改，已有标注可能错位', 'error')
        }
      } catch {
        set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, missing: true } : f)) }))
        get().notify('原始文件已不在原位置', 'error')
        return
      }
      await get().openFile(id)
    },

    closeTab: (id) => {
      set((s) => {
        const tabs = s.workspace.tabs.filter((t) => t !== id)
        const activeTab = s.workspace.activeTab === id ? tabs[tabs.length - 1] ?? null : s.workspace.activeTab
        return { workspace: { ...s.workspace, tabs, activeTab } }
      })
      persist()
    },

    setPage: (fileId, page) => {
      const file = get().files.find((f) => f.id === fileId)
      const total = file?.pageCount || 1
      const next = Math.min(Math.max(1, Math.round(page)), total)
      set((s) => ({ workspace: { ...s.workspace, pages: { ...s.workspace.pages, [fileId]: next } } }))
      persist()
    },

    setZoom: (zoom) => {
      set((s) => ({ workspace: { ...s.workspace, zoom: Math.min(3, Math.max(0.6, zoom)) } }))
      persist()
    },

    setReaderPanel: (panel) => set((s) => ({ workspace: { ...s.workspace, readerPanel: panel } })),
    setContextScope: (scope) => {
      set((s) => ({ workspace: { ...s.workspace, contextScope: scope } }))
      persist()
    },

    toggleFavorite: (id) => {
      set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, favorite: !f.favorite } : f)) }))
      persist()
    },

    removeFile: (id) => {
      set((s) => ({
        files: s.files.filter((f) => f.id !== id),
        annotations: s.annotations.filter((a) => a.fileId !== id),
        workspace: {
          ...s.workspace,
          tabs: s.workspace.tabs.filter((t) => t !== id),
          activeTab: s.workspace.activeTab === id ? s.workspace.tabs.filter((t) => t !== id).pop() ?? null : s.workspace.activeTab
        }
      }))
      persist()
      get().notify('已从资料库移除，原始文件未被删除')
    },

    revealFile: (id) => {
      const file = get().files.find((f) => f.id === id)
      if (file) window.cs.reveal(file.path)
    },

    setSelection: (selection) => set({ selection }),
    focusOn: (fileId, page, quote) => {
      set({ focusQuote: { fileId, page, quote, nonce: Date.now() } })
    },

    addAnnotation: (fileId, page, rects, text) => {
      const annotation: Annotation = { id: uid(), fileId, page, rects, text, createdAt: Date.now() }
      set((s) => ({ annotations: [annotation, ...s.annotations] }))
      persist()
    },

    removeAnnotation: (id) => {
      set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }))
      persist()
    },

    createNote: (title = '未命名笔记') => {
      const now = Date.now()
      const note: Note = { id: uid(), title, body: '', refs: [], createdAt: now, updatedAt: now }
      set((s) => ({ notes: [note, ...s.notes], workspace: { ...s.workspace, activeNoteId: note.id } }))
      persist()
      return note.id
    },

    selectNote: (id) => {
      set((s) => ({ workspace: { ...s.workspace, activeNoteId: id } }))
      persist()
    },

    updateNote: (id, patch) => {
      set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n))
      }))
      persist()
    },

    deleteNote: (id) => {
      set((s) => {
        const notes = s.notes.filter((n) => n.id !== id)
        const activeNoteId = s.workspace.activeNoteId === id ? notes[0]?.id ?? null : s.workspace.activeNoteId
        return { notes, workspace: { ...s.workspace, activeNoteId } }
      })
      persist()
    },

    insertToNote: (noteId, markdown, refs = []) => {
      const state = get()
      const id = noteId ?? state.createNote()
      const note = get().notes.find((n) => n.id === id)
      if (!note) return id
      const newRefs: NoteRef[] = refs.map((r) => ({ ...r, id: uid().slice(0, 8), createdAt: Date.now() }))
      const block = newRefs.length ? markdown.trim().replace(/csref:NEW/g, 'csref:' + newRefs[0].id) : markdown.trim()
      const body = `${note.body.trimEnd()}\n\n${block}\n`
      set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? { ...n, body, refs: [...n.refs, ...newRefs], updatedAt: Date.now() } : n)),
        workspace: { ...s.workspace, activeNoteId: id }
      }))
      persist()
      return id
    },

    insertSelectionToNote: () => {
      const { selection, files } = get()
      if (!selection) return
      const file = files.find((f) => f.id === selection.fileId)
      if (!file) return
      const label = `${file.name} · 第 ${selection.page} 页`
      const markdown = `> ${selection.text}

[来源：${label}](csref:NEW)`
      get().insertToNote(get().workspace.activeNoteId, markdown, [
        { fileId: file.id, page: selection.page, quote: selection.text, label }
      ])
      get().notify('已加入笔记')
      set({ selection: null })
    },

    insertAnswerToNote: (messageId) => {
      const message = get().messages.find((m) => m.id === messageId)
      if (!message) return
      const file = get().files.find((f) => f.id === message.fileId) ?? get().files.find((f) => f.id === get().workspace.activeTab)
      const refs = (message.citations || []).filter((c) => c.verified).map((c) => ({
        fileId: file?.id ?? '',
        page: c.page,
        quote: c.quote,
        label: file ? `${file.name} · 第 ${c.page} 页` : `第 ${c.page} 页`
      }))
      const sourceLine = refs.length && file
        ? `

[来源：${file.name} · 第 ${refs[0].page} 页](csref:NEW)`
        : ''
      const body = message.content.replace(/\[\[\s*p\s*\d+\s*\]\]/gi, '').trim()
      get().insertToNote(get().workspace.activeNoteId, `${body}${sourceLine}`, refs)
      get().notify('回答已加入笔记')
    },

    setActiveProvider: (id) => {
      set({ activeProviderId: id })
      persist()
    },

    updateProvider: (id, patch) => {
      set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      persist()
    },

    saveKey: async (id, key) => {
      await window.cs.setKey(id, key)
      set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, hasKey: true } : p)) }))
    },

    clearKey: async (id) => {
      await window.cs.clearKey(id)
      set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, hasKey: false } : p)) }))
    },

    sendQuestion: async (question) => {
      const state = get()
      const file = state.files.find((f) => f.id === state.workspace.activeTab)
      if (!file) {
        state.notify('请先打开一份资料', 'error')
        return
      }
      if (state.streaming) return
      const trimmed = question.trim()
      if (!trimmed) return
      const provider = state.providers.find((p) => p.id === state.activeProviderId) ?? state.providers[0]
      if (provider.kind !== 'demo' && !provider.hasKey) {
        state.notify('请先在模型服务中填写该服务的 API Key', 'error')
        return
      }
      const page = state.workspace.pages[file.id] ?? 1
      const pages = textCache.get(file.id) ?? []
      const selection = state.selection && state.selection.fileId === file.id ? state.selection : null
      const scope = state.workspace.contextScope
      const { contextText, label } = buildContext({ file, page, pages, scope, selection })
      const history = state.messages
        .filter((m) => m.content.trim() && m.status !== 'error')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }))

      const userMessage: ChatMessage = {
        id: uid(),
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
        contextLabel: label,
        fileId: file.id,
        page
      }
      const assistant: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'streaming',
        providerName: provider.name,
        model: provider.model,
        fileId: file.id,
        page
      }
      const reqId = uid()
      set((s) => ({
        messages: [...s.messages, userMessage, assistant],
        streaming: { reqId, messageId: assistant.id },
        selection: null
      }))
      persist()

      const demoText = provider.kind === 'demo' ? demoAnswer({ file, page, pages, selection, question: trimmed }) : undefined
      await window.cs.startAI(reqId, {
        provider,
        system: SYSTEM_PROMPT,
        messages: [...history, { role: 'user', content: `${contextText}\n\n问题：${trimmed}` }],
        demoText
      })
    },

    stopAnswer: () => {
      const streaming = get().streaming
      if (!streaming) return
      window.cs.cancelAI(streaming.reqId)
    },

    handleAIEvent: (event) => {
      const state = get()
      const streaming = state.streaming
      if (!streaming || streaming.reqId !== event.reqId) return

      if (event.type === 'delta') {
        const delta = event.delta || ''
        set((s) => ({
          messages: s.messages.map((m) => (m.id === streaming.messageId ? { ...m, content: m.content + delta } : m))
        }))
        return
      }

      if (event.type === 'done') {
        const message = get().messages.find((m) => m.id === streaming.messageId)
        const file = get().files.find((f) => f.id === get().workspace.activeTab)
        const pages = file ? textCache.get(file.id) ?? [] : []
        const raw = event.text ?? message?.content ?? ''
        const parsed = parseAnswer(raw, pages)
        set((s) => ({
          streaming: null,
          messages: s.messages.map((m) =>
            m.id === streaming.messageId
              ? {
                  ...m,
                  content: parsed.content || m.content,
                  citations: parsed.citations,
                  status: event.stopped ? 'stopped' : 'done'
                }
              : m
          )
        }))
        persist()
        return
      }

      if (event.type === 'error') {
        set((s) => ({
          streaming: null,
          messages: s.messages.map((m) =>
            m.id === streaming.messageId
              ? { ...m, status: 'error', error: event.message || '请求失败', content: m.content || '' }
              : m
          )
        }))
        get().notify(event.message || 'AI 请求失败', 'error')
        persist()
      }
    },

    focusComposer: () => set((s) => ({ composerFocus: s.composerFocus + 1 }))
  }
})

function buildContext ({ file, page, pages, scope, selection }: {
  file: FileRec
  page: number
  pages: string[]
  scope: WorkspaceState['contextScope']
  selection: { text: string } | null
}): { contextText: string; label: string } {
  const pageText = pages[page - 1] || ''
  const parts: string[] = [`资料：《${file.name}》`]

  if (scope === 'file') {
    const joined = pages.map((text, i) => `【第 ${i + 1} 页】\n${text}`).join('\n')
    parts.push(joined.slice(0, 12000))
    parts.push('（内容较长，已截断）')
  } else {
    parts.push(`【第 ${page} 页】\n${pageText.slice(0, 6000)}`)
  }
  if (selection?.text) parts.push(`【选中内容】\n${selection.text}`)

  const label = `${file.name} · 第 ${page} 页${selection ? ' · 选中内容' : scope === 'file' ? ' · 当前文件' : ''}`
  return { contextText: parts.join('\n\n'), label }
}

function demoAnswer ({ file, page, pages, selection, question }: {
  file: FileRec
  page: number
  pages: string[]
  selection: { text: string } | null
  question: string
}): string {
  const rawPage = pages[page - 1] || ''
  const pageText = rawPage.replace(/\s+/g, ' ').trim()
  const lines = rawPage.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean)
  const sentence = lines.find((line) => line.length >= 12 && /[.!?。！？]$/.test(line)) || lines.find((line) => line.length >= 12) || pageText.slice(0, 60)
  const focus = selection?.text || sentence || '这一页的内容'
  return [
    '（演示模式：下面的回答由本地模板生成，不会把资料发送到任何服务。）',
    '',
    `关于「${question.length > 36 ? question.slice(0, 36) + '…' : question}」，这一页的核心可以用一句话概括：${sentence || '本页没有可提取的文字。'}`,
    '',
    '**可以从三个角度理解**',
    '',
    `1. 原文表述：${pageText.slice(0, 120)}${pageText.length > 120 ? '…' : ''}`,
    `2. 关键对象：「${focus.slice(0, 50)}」是理解本页的入口。`,
    '3. 下一步：把这个概念和下一节的工作模式对照起来看，注意输入长度与处理单位的区别。',
    '',
    `以上内容依据《${file.name}》第 ${page} 页。`,
    `[[p${page}]]`,
    `@cite ${page} | ${sentence || focus.slice(0, 40)}`
  ].join('\n')
}
