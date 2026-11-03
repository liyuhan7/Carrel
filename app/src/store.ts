import { create } from 'zustand'
import type {
  ActiveModel, AIMessage, Annotation, ChatMessage, CredentialSource, DeviceCode, FileKind, FileRec,
  Note, NoteRef, PersistedState, ProviderAuthState, ProviderConnection, Rect, RewriteState,
  SourceDetection, WorkspaceState
} from './types'
import {
  CUSTOM_PRESET, CUSTOM_PRESET_ID, DEFAULT_ACTIVE_MODEL, DEFAULT_CONNECTIONS,
  activeRoute, adoptSaved, connectionFromPreset, mergeDiscovered, presetOf, routeOf, supportsImage
} from './lib/providers'
import { extractPageTexts, loadPdf, renderPageImage, type PageImage } from './lib/pdf'
import { parseAnswer } from './lib/verify'
import { uid } from './lib/format'
import type {
  AnchorService, LinkService, NavigationService, ResourceRegistry, StateTransactionService
} from './shared/contracts/content'
import {
  createAnchorService, createLinkService, createNavigationService, createResourceRegistry,
  createTransactionService, type SharedDataPort
} from './shared/services'

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
  settingsConnection: string | null
  rewrite: RewriteState | null
  /** Shared content services; see shared/services/. */
  resourceRegistry: ResourceRegistry
  anchorService: AnchorService
  linkService: LinkService
  navigation: NavigationService
  transactions: StateTransactionService

  hydrate: () => Promise<void>
  openSettings: (connectionId?: string) => void
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

  setActiveModel: (connectionId: string, modelId: string) => void
  updateConnection: (id: string, patch: Partial<ProviderConnection>) => void
  addConnection: () => string
  removeConnection: (id: string) => void
  toggleModel: (connectionId: string, modelId: string, enabled: boolean) => void
  addModel: (connectionId: string, modelId: string) => void
  setDefaultModel: (connectionId: string, modelId: string) => void
  saveKey: (id: string, key: string) => Promise<void>
  clearKey: (id: string) => Promise<void>
  setAuthMethod: (id: string, method: ProviderConnection['authMethod']) => void
  refreshAuth: () => Promise<void>
  setOAuthClientSecret: (id: string, secret: string) => Promise<void>
  beginOAuth: (id: string) => Promise<void>
  signOut: (id: string) => Promise<void>
  detectSources: (sources: CredentialSource[]) => Promise<Record<string, SourceDetection>>
  importSource: (id: string, source: CredentialSource) => Promise<{ ok: boolean; message: string }>
  copilotBegin: () => Promise<DeviceCode>
  copilotPoll: (id: string, deviceCode: string) => Promise<{ status: 'pending' | 'ok' | 'error'; message?: string }>
  refreshModels: (id: string) => Promise<void>
  setAttachPageImage: (value: boolean) => void

  startRewrite: (input: { noteId: string; start: number; end: number; text: string; instruction: string }) => Promise<void>
  cancelRewrite: () => void
  applyRewrite: () => void

  sendQuestion: (question: string) => Promise<void>
  stopAnswer: () => void
  handleAIEvent: (event: { type: string; reqId: string; delta?: string; text?: string; message?: string; stopped?: boolean }) => void
  focusComposer: () => void
  // >>> integration:unified-content-index
  /** Search hit target: the AI pane scrolls this message into view. */
  messageFocus: { messageId: string; nonce: number } | null
  focusMessage: (messageId: string) => void
  // <<< integration:unified-content-index
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
    resources: state.resources,
    anchors: state.anchors,
    links: state.links,
    connections: state.connections.map(({ hasKey: _hasKey, ...rest }) => rest),
    activeModel: state.activeModel,
    workspace: state.workspace
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function withAuth (connection: ProviderConnection, auth?: ProviderAuthState): ProviderConnection {
  return {
    ...connection,
    hasKey: Boolean(auth?.hasKey),
    hasOAuth: Boolean(auth?.hasOAuth),
    hasOAuthClient: Boolean(auth?.hasOAuthClient),
    oauthExpiresAt: auth?.oauthExpiresAt,
    hasSubscription: Boolean(auth?.hasSubscription),
    subscriptionAccount: auth?.subscriptionAccount,
    subscriptionExpiresAt: auth?.subscriptionExpiresAt
  }
}

const REWRITE_PROMPT = '你是笔记编辑器。只改写用户给出的片段：保持原意与事实，保留 Markdown 结构，只输出改写后的片段本身，不要解释、不要加标题、不要代码块围栏。'

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

  const sharedPort: SharedDataPort = {
    read: () => ({ resources: get().resources, anchors: get().anchors, links: get().links }),
    write: (next) => {
      set({ resources: next.resources, anchors: next.anchors, links: next.links })
      persist()
    },
    // Annotations are migrated to anchorId by the reading module; tolerate both shapes.
    isAnchorUsed: (anchorId) =>
      get().annotations.some((item) => (item as { anchorId?: string }).anchorId === anchorId),
    now: () => Date.now(),
    nextId: () => uid()
  }
  const resourceRegistry = createResourceRegistry(sharedPort)
  const anchorService = createAnchorService(sharedPort)
  const linkService = createLinkService(sharedPort)
  const transactions = createTransactionService(sharedPort)
  const navigation = createNavigationService(sharedPort, {
    async openDocument (sourceId, location) {
      if (!get().files.some((item) => item.id === sourceId)) throw new Error('来源文件不可访问')
      if (!get().workspace.tabs.includes(sourceId)) await get().openFile(sourceId)
      if (location?.page) get().setPage(sourceId, location.page)
      if (location?.quote) get().focusOn(sourceId, location.page ?? 1, location.quote)
    },
    openNote (sourceId) {
      get().selectNote(sourceId)
      set({ view: 'notes' })
    },
    openConversation () {
      set({ view: 'workspace' })
    }
  })

  return {
    files: [],
    notes: [],
    annotations: [],
    messages: [],
    resources: {},
    anchors: {},
    links: {},
    connections: DEFAULT_CONNECTIONS,
    activeModel: DEFAULT_ACTIVE_MODEL,
    workspace: {
      tabs: [],
      activeTab: null,
      pages: {},
      zoom: 1,
      activeNoteId: null,
      contextScope: 'selection',
      readerPanel: 'doc',
      attachPageImage: false
    },
    resourceRegistry,
    anchorService,
    linkService,
    navigation,
    transactions,
    hydrated: false,
    view: 'home',
    saveStatus: 'saved',
    selection: null,
    focusQuote: null,
    toasts: [],
    streaming: null,
    composerFocus: 0,
    settingsOpen: false,
    settingsConnection: null,
    rewrite: null,
    // >>> integration:unified-content-index
    messageFocus: null,
    // <<< integration:unified-content-index

    openSettings: (connectionId) => set({ settingsOpen: true, settingsConnection: connectionId ?? get().activeModel.connectionId }),
    closeSettings: () => set({ settingsOpen: false, settingsConnection: null }),
    importDialog: async () => {
      const paths = await window.cs.pickFiles()
      await get().importPaths(paths)
    },

    hydrate: async () => {
      const { state, auth } = await window.cs.getState()
      if (state && state.workspace) {
        const { connections, activeModel } = adoptSaved(state)
        const defaults: WorkspaceState = {
          tabs: [],
          activeTab: null,
          pages: {},
          zoom: 1,
          activeNoteId: null,
          contextScope: 'selection',
          readerPanel: 'doc',
          attachPageImage: false
        }
        set({
          files: state.files ?? [],
          notes: state.notes ?? [],
          annotations: state.annotations ?? [],
          messages: state.messages ?? [],
          resources: state.resources ?? {},
          anchors: state.anchors ?? {},
          links: state.links ?? {},
          workspace: { ...defaults, ...state.workspace },
          connections: connections.map((item) => withAuth(item, auth[item.id])),
          activeModel,
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
          connections: DEFAULT_CONNECTIONS.map((item) => withAuth(item)),
          activeModel: DEFAULT_ACTIVE_MODEL,
          notes: [note],
          workspace: { tabs: [], activeTab: null, pages: {}, zoom: 1, activeNoteId: note.id, contextScope: 'selection', readerPanel: 'doc', attachPageImage: false },
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

    setActiveModel: (connectionId, modelId) => {
      set({ activeModel: { connectionId, modelId } })
      persist()
    },

    updateConnection: (id, patch) => {
      set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      persist()
    },

    addConnection: () => {
      const id = `custom-${uid().slice(0, 8)}`
      const connection: ProviderConnection = { ...connectionFromPreset(CUSTOM_PRESET), id, name: '自定义服务' }
      set((s) => ({ connections: [...s.connections, connection], settingsOpen: true, settingsConnection: id }))
      persist()
      return id
    },

    removeConnection: (id) => {
      const connection = get().connections.find((c) => c.id === id)
      if (!connection || connection.presetId !== CUSTOM_PRESET_ID) return
      void window.cs.clearKey(id)
      set((s) => ({
        connections: s.connections.filter((c) => c.id !== id),
        activeModel: s.activeModel.connectionId === id ? DEFAULT_ACTIVE_MODEL : s.activeModel,
        settingsConnection: null
      }))
      persist()
      get().notify(`已移除 ${connection.name}`)
    },

    toggleModel: (connectionId, modelId, enabled) => {
      set((s) => ({
        connections: s.connections.map((c) => {
          if (c.id !== connectionId) return c
          const ids = enabled
            ? (c.enabledModelIds.includes(modelId) ? c.enabledModelIds : [...c.enabledModelIds, modelId])
            : c.enabledModelIds.filter((item) => item !== modelId)
          return { ...c, enabledModelIds: ids, defaultModelId: ids.includes(c.defaultModelId ?? '') ? c.defaultModelId : ids[0] }
        })
      }))
      const state = get()
      const connection = state.connections.find((c) => c.id === connectionId)
      if (connection && state.activeModel.connectionId === connectionId && !enabled) {
        const next = connection.defaultModelId
        if (next) set({ activeModel: { connectionId, modelId: next } })
      }
      persist()
    },

    addModel: (connectionId, modelId) => {
      const trimmed = modelId.trim()
      if (!trimmed) return
      set((s) => ({
        connections: s.connections.map((c) => (c.id === connectionId
          ? {
              ...c,
              enabledModelIds: c.enabledModelIds.includes(trimmed) ? c.enabledModelIds : [...c.enabledModelIds, trimmed],
              defaultModelId: c.defaultModelId ?? trimmed
            }
          : c))
      }))
      persist()
    },

    setDefaultModel: (connectionId, modelId) => {
      set((s) => ({ connections: s.connections.map((c) => (c.id === connectionId ? { ...c, defaultModelId: modelId } : c)) }))
      persist()
    },

    saveKey: async (id, key) => {
      await window.cs.setKey(id, key)
      set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, hasKey: true } : c)) }))
    },

    clearKey: async (id) => {
      await window.cs.clearKey(id)
      set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, hasKey: false } : c)) }))
    },

    setAuthMethod: (id, method) => {
      set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, authMethod: method } : c)) }))
      persist()
    },

    refreshAuth: async () => {
      const auth = await window.cs.authState()
      set((s) => ({ connections: s.connections.map((c) => withAuth(c, auth[c.id])) }))
    },

    setOAuthClientSecret: async (id, secret) => {
      await window.cs.setOAuthClient(id, secret)
      await get().refreshAuth()
    },

    beginOAuth: async (id) => {
      const connection = get().connections.find((c) => c.id === id)
      const preset = connection ? presetOf(connection) : undefined
      if (!connection || !preset?.oauth) {
        get().notify('该服务没有配置 OAuth', 'error')
        return
      }
      if (!connection.oauthClientId) {
        get().notify('请先填写 OAuth 客户端 ID', 'error')
        return
      }
      get().notify('已打开浏览器，请完成授权')
      const result = await window.cs.oauthBegin({ connectionId: id, oauth: preset.oauth, clientId: connection.oauthClientId })
      await get().refreshAuth()
      get().notify(result.message, result.ok ? 'info' : 'error')
    },

    signOut: async (id) => {
      const connection = get().connections.find((c) => c.id === id)
      if (!connection) return
      if (connection.authMethod === 'oauth') await window.cs.oauthSignout(id)
      else await window.cs.subscriptionSignout(id)
      await get().refreshAuth()
      get().notify('已退出授权')
    },

    detectSources: (sources) => window.cs.subscriptionDetect(sources),

    importSource: async (id, source) => {
      const result = await window.cs.subscriptionImport(id, source)
      await get().refreshAuth()
      get().notify(result.message, result.ok ? 'info' : 'error')
      return result
    },

    copilotBegin: () => window.cs.copilotBegin(),

    copilotPoll: async (id, deviceCode) => {
      const result = await window.cs.copilotPoll(id, deviceCode)
      if (result.status === 'ok') {
        await get().refreshAuth()
        get().notify('Copilot 已授权')
      }
      return result
    },

    refreshModels: async (id) => {
      const connection = get().connections.find((c) => c.id === id)
      if (!connection) return
      if (presetOf(connection)?.modelList === 'registry') {
        get().notify('该服务不提供模型列表，使用内置目录', 'error')
        return
      }
      const result = await window.cs.listModels({
        connectionId: connection.id,
        protocol: connection.protocol,
        baseUrl: connection.baseUrl,
        authMethod: connection.authMethod,
        projectId: connection.oauthProjectId
      })
      if (!result.ok) {
        get().notify(result.message, 'error')
        return
      }
      const models = mergeDiscovered(connection, result.models)
      const enabled = connection.enabledModelIds.length
        ? connection.enabledModelIds
        : models.slice(0, 3).map((model) => model.modelId)
      set((s) => ({
        connections: s.connections.map((c) => (c.id === id
          ? {
              ...c,
              models,
              modelsFetchedAt: Date.now(),
              enabledModelIds: enabled,
              defaultModelId: c.defaultModelId ?? enabled[0]
            }
          : c))
      }))
      persist()
      get().notify(result.message)
    },

    setAttachPageImage: (value) => {
      set((s) => ({ workspace: { ...s.workspace, attachPageImage: value } }))
      persist()
    },

    startRewrite: async ({ noteId, start, end, text, instruction }) => {
      const state = get()
      if (state.rewrite?.status === 'streaming') return
      const active = activeRoute(state.connections, state.activeModel)
      if (!active) {
        state.notify('先选择一个模型', 'error')
        return
      }
      const reqId = uid()
      set({ rewrite: { reqId, noteId, start, end, original: text, text: '', status: 'streaming' } })
      const demoText = active.connection.protocol === 'demo' ? '（演示模式）\n' + text : undefined
      await window.cs.startAI(reqId, {
        route: routeOf(active.connection, active.model),
        system: REWRITE_PROMPT,
        messages: [{ role: 'user', content: instruction + '\n\n---\n' + text }],
        demoText
      })
    },

    cancelRewrite: () => {
      const rewrite = get().rewrite
      if (rewrite?.status === 'streaming') window.cs.cancelAI(rewrite.reqId)
      set({ rewrite: null })
    },

    applyRewrite: () => {
      const rewrite = get().rewrite
      if (!rewrite || rewrite.status !== 'done') return
      const note = get().notes.find((n) => n.id === rewrite.noteId)
      if (!note) return
      const body = note.body.slice(0, rewrite.start) + rewrite.text + note.body.slice(rewrite.end)
      get().updateNote(note.id, { body })
      set({ rewrite: null })
      get().notify('已应用整理结果')
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
      const active = activeRoute(state.connections, state.activeModel)
      if (!active) {
        state.notify('请先在模型服务里启用一个模型', 'error')
        return
      }
      const { connection, model } = active
      if (connection.protocol !== 'demo' && !connection.hasKey) {
        state.notify('请先在模型服务中填写该服务的 API Key', 'error')
        return
      }
      const page = state.workspace.pages[file.id] ?? 1
      const pages = textCache.get(file.id) ?? []
      const selection = state.selection && state.selection.fileId === file.id ? state.selection : null
      const scope = state.workspace.contextScope
      const { contextText, label } = buildContext({ file, page, pages, scope, selection })
      const wantsImage = supportsImage(model) && state.workspace.attachPageImage && file.kind === 'pdf'
      let image: PageImage | null = null
      if (wantsImage) {
        try {
          image = await renderPageImage(file.id, page)
        } catch {
          image = null
        }
      }
      const history = state.messages
        .filter((m) => m.content.trim() && m.status !== 'error')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }))

      const userMessage: ChatMessage = {
        id: uid(),
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
        contextLabel: image ? `${label} · 含本页截图` : label,
        fileId: file.id,
        page
      }
      const assistant: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'streaming',
        providerName: connection.name,
        model: model.modelId,
        fileId: file.id,
        page,
        withImage: Boolean(image)
      }
      const reqId = uid()
      set((s) => ({
        messages: [...s.messages, userMessage, assistant],
        streaming: { reqId, messageId: assistant.id },
        selection: null
      }))
      persist()

      const demoText = connection.protocol === 'demo' ? demoAnswer({ file, page, pages, selection, question: trimmed }) : undefined
      const prompt = `${contextText}\n\n问题：${trimmed}`
      const content: AIMessage['content'] = image
        ? [{ type: 'text', text: prompt }, { type: 'image', mediaType: image.mediaType, data: image.data }]
        : prompt
      await window.cs.startAI(reqId, {
        route: routeOf(connection, model),
        system: SYSTEM_PROMPT,
        messages: [...history, { role: 'user', content }],
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
      const rewrite = state.rewrite
      if (rewrite && rewrite.reqId === event.reqId) {
        if (event.type === 'delta') {
          set((s) => ({ rewrite: s.rewrite ? { ...s.rewrite, text: s.rewrite.text + (event.delta || '') } : null }))
          return
        }
        if (event.type === 'done') {
          set((s) => ({ rewrite: s.rewrite ? { ...s.rewrite, text: event.text || s.rewrite.text, status: 'done' } : null }))
          return
        }
        if (event.type === 'error') {
          set((s) => ({ rewrite: s.rewrite ? { ...s.rewrite, status: 'error', error: event.message || '整理失败' } : null }))
          return
        }
      }
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

    focusComposer: () => set((s) => ({ composerFocus: s.composerFocus + 1 })),
    // >>> integration:unified-content-index
    focusMessage: (messageId) => set({ messageFocus: { messageId, nonce: Date.now() }, view: 'workspace' })
    // <<< integration:unified-content-index
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
