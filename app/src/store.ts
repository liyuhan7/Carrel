import { create } from 'zustand'
import type {
  ActiveModel, AIMessage, ChatMessage, CredentialSource, DeviceCode, FileKind, FileRec,
  Note, NoteRef, PersistedState, ProviderAuthState, ProviderConnection, Rect, RewriteState,
  SourceDetection, WorkspaceState
} from './types'
// >>> integration:course-reading-annotation
import type {
  Annotation as ReaderAnnotation,
  AnnotationStyle,
  ReadingState,
  SelectionDraft
} from './shared/contracts/reader'
import { createAnnotationService, type AnnotationPort, type ReaderAnnotationService } from './reader/annotationService'
import { createAsksAboutLink } from './reader/links'
import { migrateStoredAnnotations } from './reader/migrate'
import type { LegacyAnnotationRecord, LegacyFileMeta } from './reader/migrate'
import { clampReadingState, createReadingState, patchReadingState } from './reader/readingState'
import type { ReadingStatePatch } from './reader/readingState'
// <<< integration:course-reading-annotation
import {
  CUSTOM_PRESET, CUSTOM_PRESET_ID, DEFAULT_ACTIVE_MODEL, DEFAULT_CONNECTIONS,
  activeRoute, adoptSaved, authReady, connectionFromPreset, mergeDiscovered, presetOf,
  reconcileEnabled, routeOf, supportsImage
} from './lib/providers'
import { extractPageTexts, dropPdf, loadPdf, renderPageImage, type PageImage } from './lib/pdf'
import { parseAnswer } from './lib/verify'
import { uid } from './lib/format'
import type {
  AnchorService, LinkService, NavigationService, Resource, ResourceRef, ResourceRegistry,
  StateTransactionService
} from './shared/contracts/content'
import {
  createAnchorService, createLinkService, createNavigationService, createResourceRegistry,
  createTransactionService, type SharedDataPort
} from './shared/services'
// >>> integration:note-capture-editing
import { noteSessions } from './notes/session'
import { createNoteInsertService, type NoteDocumentCommit } from './notes/insertService'
import { ensureNoteState } from './notes/migrate'
import { revisionOf } from './notes/blocks'
import {
  buildCaptureMarkdown, capturePlacement, captureTargetNoteId, sourceLabel, stripCiteMarkers
} from './notes/capture'
import { useNoteUi } from './notes/ui'
import type {
  InsertCaptureCommand, InsertCaptureResult, NoteBlock, NoteSourceCandidate, WritingPosition
} from './notes/contracts'
// <<< integration:note-capture-editing

export type View = 'home' | 'workspace' | 'library' | 'notes'

/** Extracted page text lives outside React state: it can be megabytes. */
export const textCache = new Map<string, string[]>()

interface Toast { id: string; text: string; tone: 'info' | 'error' }

interface Store extends PersistedState {
  hydrated: boolean
  view: View
  saveStatus: 'saved' | 'saving' | 'error'
  selection: {
    fileId: string
    page: number
    text: string
    // >>> integration:course-reading-annotation
    /** In-memory selector for the pending selection; cleared on send/cancel. */
    draft?: SelectionDraft
    // <<< integration:course-reading-annotation
  } | null
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
  // >>> integration:course-reading-annotation
  annotationService: ReaderAnnotationService
  // <<< integration:course-reading-annotation

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

  setSelection: (selection: Store['selection']) => void
  focusOn: (fileId: string, page: number, quote: string) => void
  addAnnotation: (fileId: string, page: number, rects: Rect[], text: string) => void
  removeAnnotation: (id: string) => Promise<void>
  // >>> integration:course-reading-annotation
  createAnnotation: (
    selection: SelectionDraft,
    kind: ReaderAnnotation['kind'],
    style: AnnotationStyle,
    body?: string
  ) => Promise<ReaderAnnotation | null>
  updateAnnotation: (
    annotationId: string,
    changes: { style?: AnnotationStyle; body?: string }
  ) => Promise<void>
  undoAnnotation: (resourceId: string) => Promise<boolean>
  /** Ensure (kind:'document', sourceId:fileId) exists; returns its Resource.id. */
  ensureFileResource: (fileId: string) => Promise<string | null>
  setReadingState: (resourceId: string, patch: ReadingStatePatch) => void
  // <<< integration:course-reading-annotation

  createNote: (title?: string) => string
  selectNote: (id: string) => void
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body'>>) => void
  deleteNote: (id: string) => void
  insertToNote: (noteId: string | null, markdown: string, refs?: Omit<NoteRef, 'id' | 'createdAt'>[]) => string
  insertSelectionToNote: () => void
  insertAnswerToNote: (messageId: string) => void
  // >>> integration:note-capture-editing
  /** Single insert command for reader captures, AI drafts and in-note sources. */
  insertCapture: (command: InsertCaptureCommand) => Promise<InsertCaptureResult>
  undoInsert: (operationId: string) => Promise<boolean>
  undoNoteEdit: (noteId: string) => Promise<void>
  redoNoteEdit: (noteId: string) => void
  saveNotePosition: (noteId: string, position: WritingPosition, blocks: NoteBlock[]) => void
  ensureResource: (ref: ResourceRef & { title?: string }) => Promise<Resource>
  closeNoteTab: (id: string) => void
  restoreNote: (id: string) => void
  restoreLastDeleted: () => void
  // <<< integration:note-capture-editing

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
  refreshSubscription: (id: string) => Promise<void>
  copilotBegin: () => Promise<DeviceCode>
  copilotPoll: (id: string, deviceCode: string) => Promise<{ status: 'pending' | 'ok' | 'error'; message?: string }>
  refreshModels: (id: string, quiet?: boolean) => Promise<void>
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

// >>> integration:note-capture-editing
/** Note document staged by an insert command and committed by the shared port write. */
let pendingNoteDocument: NoteDocumentCommit | null = null

function stageNoteDocument (doc: NoteDocumentCommit | null): void {
  pendingNoteDocument = doc
}

/** Most recently used note tabs, capped at five; dropping a tab keeps the note. */
function nextTabs (tabs: string[] | undefined, id: string): string[] {
  const rest = (tabs ?? []).filter((item) => item !== id)
  return [...rest, id].slice(-5)
}
// <<< integration:note-capture-editing

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
    // >>> integration:course-reading-annotation
    legacyAnnotations: state.legacyAnnotations,
    readingStates: state.readingStates,
    // <<< integration:course-reading-annotation
    messages: state.messages,
    // >>> integration:note-capture-editing
    noteBlocks: state.noteBlocks,
    notePositions: state.notePositions,
    noteTrash: state.noteTrash,
    // <<< integration:note-capture-editing
    resources: state.resources,
    anchors: state.anchors,
    links: state.links,
    connections: state.connections.map(({ hasKey: _hasKey, ...rest }) => rest),
    activeModel: state.activeModel,
    workspace: state.workspace
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

// >>> integration:course-reading-annotation
/** Document Resource.id for an existing file; never a raw fileId. */
function documentResourceId (state: { resources: Store['resources'] }, fileId: string): string | undefined {
  return Object.values(state.resources).find(
    (resource) => resource.kind === 'document' && resource.sourceId === fileId
  )?.id
}
// <<< integration:course-reading-annotation

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
  /**
   * `quiet` writes the same snapshot without flashing the save indicator:
   * reading progress and view state are not document content.
   */
  const persist = (quiet = false) => {
    if (!quiet) set({ saveStatus: 'saving' })
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
      // >>> integration:note-capture-editing
      const staged = pendingNoteDocument
      pendingNoteDocument = null
      if (staged) {
        set((state) => ({
          resources: next.resources,
          anchors: next.anchors,
          links: next.links,
          notes: state.notes.map((note) =>
            note.id === staged.noteId ? { ...note, body: staged.body, updatedAt: Date.now() } : note
          ),
          noteBlocks: { ...state.noteBlocks, [staged.noteId]: staged.blocks },
          notePositions: { ...state.notePositions, [staged.noteId]: staged.position }
        }))
      } else {
        set({ resources: next.resources, anchors: next.anchors, links: next.links })
      }
      // <<< integration:note-capture-editing
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

  // >>> integration:course-reading-annotation
  const annotationPort: AnnotationPort = {
    read: () => get().annotations,
    write: (next) => {
      set({ annotations: next })
      persist()
    },
    now: () => Date.now(),
    nextId: () => uid()
  }
  const annotationService = createAnnotationService({ port: annotationPort, anchorService, transactions })
  // <<< integration:course-reading-annotation

  // >>> integration:note-capture-editing
  noteSessions.configure({
    readPosition: (noteId) => get().notePositions[noteId],
    persist: (noteId, position, blocks) => {
      set((state) => ({
        notePositions: { ...state.notePositions, [noteId]: position },
        noteBlocks: { ...state.noteBlocks, [noteId]: blocks }
      }))
      persist()
    },
    now: () => Date.now(),
    nextId: () => uid()
  })

  const noteInsert = createNoteInsertService({
    readNote: (noteId) => {
      const note = get().notes.find((item) => item.id === noteId)
      return note ? { body: note.body, title: note.title } : undefined
    },
    readBlocks: (noteId) => get().noteBlocks[noteId] ?? [],
    readPosition: (noteId) => get().notePositions[noteId],
    readResource: (resourceId) => get().resources[resourceId],
    readNoteResourceId: (noteId) =>
      Object.values(get().resources).find(
        (resource) => resource.kind === 'note' && resource.sourceId === noteId
      )?.id,
    stageNoteDocument,
    anchorService,
    linkService,
    now: () => Date.now(),
    nextId: () => uid()
  })

  /** ResourceRegistry only takes a ResourceRef; keep the human title for source labels. */
  const ensureResource = async (ref: ResourceRef & { title?: string }): Promise<Resource> => {
    const resource = await resourceRegistry.ensureResource(ref)
    if (!ref.title || resource.title === ref.title) return resource
    const next: Resource = { ...resource, title: ref.title, updatedAt: Date.now() }
    sharedPort.write({ ...sharedPort.read(), resources: { ...get().resources, [next.id]: next } })
    return next
  }
  // <<< integration:note-capture-editing

  return {
    files: [],
    notes: [],
    annotations: [],
    // >>> integration:course-reading-annotation
    legacyAnnotations: [],
    readingStates: {},
    // <<< integration:course-reading-annotation
    messages: [],
    // >>> integration:note-capture-editing
    noteBlocks: {},
    notePositions: {},
    noteTrash: [],
    // <<< integration:note-capture-editing
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
    // >>> integration:course-reading-annotation
    annotationService,
    // <<< integration:course-reading-annotation
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
          // >>> integration:course-reading-annotation
          // Raw records are staged here and migrated below; nothing is dropped.
          annotations: [],
          legacyAnnotations: (state as unknown as { legacyAnnotations?: LegacyAnnotationRecord[] }).legacyAnnotations ?? [],
          readingStates: (state as unknown as { readingStates?: Record<string, ReadingState> }).readingStates ?? {},
          // <<< integration:course-reading-annotation
          messages: state.messages ?? [],
          // >>> integration:note-capture-editing
          noteBlocks: state.noteBlocks ?? {},
          notePositions: state.notePositions ?? {},
          noteTrash: state.noteTrash ?? [],
          // <<< integration:note-capture-editing
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
        // >>> integration:course-reading-annotation
        try {
          const raw = state as unknown as { annotations?: unknown[]; legacyAnnotations?: unknown[] }
          const migration = await migrateStoredAnnotations({
            annotations: raw.annotations ?? [],
            legacyAnnotations: raw.legacyAnnotations ?? [],
            files: (state.files ?? []).map((file) => ({
              id: file.id,
              name: file.name,
              hash: file.hash,
              mtime: file.mtime
            })),
            ensureResource: async (file: LegacyFileMeta) => {
              const resource = await resourceRegistry.ensureResource({
                kind: 'document',
                sourceId: file.id
              })
              return resource.id
            },
            anchorService,
            transactions
          })
          set({ annotations: migration.annotations, legacyAnnotations: migration.legacyAnnotations })
          if (migration.migrated > 0) get().notify(`已迁移 ${migration.migrated} 条旧标注`)
          if (migration.failures.length > 0) {
            get().notify(`${migration.failures.length} 条旧标注迁移失败，原始数据已保留`, 'error')
          }
        } catch {
          get().notify('旧标注迁移失败，原始数据已保留', 'error')
        }
        // <<< integration:course-reading-annotation
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
      // >>> integration:note-capture-editing
      // Idempotent: fills block maps and writing positions for notes that predate them.
      const migrated = ensureNoteState(get().notes, get().noteBlocks, get().notePositions, {
        now: () => Date.now(),
        nextId: () => uid()
      })
      const knownNotes = new Set(get().notes.map((note) => note.id))
      const tabs = (get().workspace.noteTabs ?? []).filter((id) => knownNotes.has(id)).slice(-5)
      set({
        noteBlocks: migrated.blocks,
        notePositions: migrated.positions,
        workspace: {
          ...get().workspace,
          noteTabs: tabs.length > 0 ? tabs : get().notes.slice(0, 5).map((note) => note.id)
        }
      })
      // <<< integration:note-capture-editing
      // Configurations saved before their provider list was ever pulled still point at
      // catalog ids; one pull replaces them with what the provider actually serves.
      const active = activeRoute(get().connections, get().activeModel)
      if (active && presetOf(active.connection)?.modelList === 'api' &&
        active.connection.hasKey && !active.connection.models?.length) {
        void get().refreshModels(active.connection.id, true)
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
      // >>> integration:course-reading-annotation
      // A file replaced outside Carrel keeps its Resource but must be re-parsed,
      // otherwise old text would silently anchor the new content.
      if (file.changed && !textCache.has(id)) {
        try {
          if (file.kind === 'pdf') {
            const bytes = await window.cs.readBytes(file.path)
            const doc = await loadPdf(id, bytes)
            const pages = await extractPageTexts(doc)
            textCache.set(id, pages)
            await window.cs.saveText(id, pages)
            if (doc.numPages !== file.pageCount) {
              set((s) => ({
                files: s.files.map((f) => (f.id === id ? { ...f, pageCount: doc.numPages } : f))
              }))
            }
          } else if (file.kind === 'md') {
            const text = await window.cs.readText(file.path)
            textCache.set(id, [text])
            await window.cs.saveText(id, [text])
          }
        } catch {
          get().notify('文件已变化，但无法重新解析内容', 'error')
        }
      }
      // <<< integration:course-reading-annotation
      if (!textCache.has(id)) {
        const pages = await window.cs.getText(id)
        if (pages) textCache.set(id, pages)
      }
      // >>> integration:course-reading-annotation
      await get().ensureFileResource(id)
      // <<< integration:course-reading-annotation
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
          // >>> integration:course-reading-annotation
          // Adopt the new hash as the effective revision so old anchors relocate
          // instead of silently drawing at stale coordinates.
          dropPdf(id)
          textCache.delete(id)
          set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, changed: true, hash: info.hash } : f)) }))
          // <<< integration:course-reading-annotation
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
      set((s) => {
        // >>> integration:course-reading-annotation
        const resourceId = documentResourceId(s, fileId)
        const states = s.readingStates ?? {}
        const readingStates = resourceId
          ? {
              ...states,
              [resourceId]: patchReadingState(
                states[resourceId] ?? createReadingState({ resourceId }),
                { location: { kind: 'page', page: next } }
              )
            }
          : states
        // <<< integration:course-reading-annotation
        return {
          workspace: { ...s.workspace, pages: { ...s.workspace.pages, [fileId]: next } },
          ...(resourceId ? { readingStates } : {})
        }
      })
      // Reading progress is not content: save it without the indicator.
      persist(true)
    },

    setZoom: (zoom) => {
      set((s) => {
        // >>> integration:course-reading-annotation
        const resourceId = s.workspace.activeTab ? documentResourceId(s, s.workspace.activeTab) : undefined
        const states = s.readingStates ?? {}
        const readingStates = resourceId
          ? {
              ...states,
              [resourceId]: patchReadingState(
                states[resourceId] ?? createReadingState({ resourceId }),
                { zoom }
              )
            }
          : states
        // <<< integration:course-reading-annotation
        return {
          workspace: { ...s.workspace, zoom: Math.min(3, Math.max(0.6, zoom)) },
          ...(resourceId ? { readingStates } : {})
        }
      })
      persist(true)
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
        // >>> integration:course-reading-annotation
        annotations: s.annotations.filter((a) => {
          const resource = s.resources[a.resourceId]
          return !(resource && resource.kind === 'document' && resource.sourceId === id)
        }),
        // <<< integration:course-reading-annotation
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
      // >>> integration:course-reading-annotation
      // Deprecated compatibility wrapper; new code goes through createAnnotation.
      void (async () => {
        const file = get().files.find((f) => f.id === fileId)
        if (!file) return
        const resourceId = await get().ensureFileResource(fileId)
        if (!resourceId) return
        const selection: SelectionDraft = {
          kind: 'text',
          resourceId,
          revision: file.hash,
          selector: {
            type: 'document-text',
            page,
            quote: { exact: text },
            rects,
            rotation: 0
          },
          text
        }
        await get().createAnnotation(selection, 'highlight', { color: '#d9c48f', opacity: 0.45, strokeWidth: 2 })
      })()
      // <<< integration:course-reading-annotation
    },

    removeAnnotation: async (id) => {
      // >>> integration:course-reading-annotation
      try {
        await annotationService.remove(id)
        get().notify('已删除标注，可按 Ctrl/Cmd+Z 撤销')
      } catch (error) {
        get().notify((error as Error).message || '无法删除标注', 'error')
      }
      // <<< integration:course-reading-annotation
    },

    // >>> integration:course-reading-annotation
    createAnnotation: async (selection, kind, style, body) => {
      try {
        return await annotationService.create({ selection, kind, style, body })
      } catch (error) {
        get().notify((error as Error).message || '无法保存标注', 'error')
        return null
      }
    },

    updateAnnotation: async (annotationId, changes) => {
      try {
        await annotationService.update(annotationId, changes)
      } catch (error) {
        get().notify((error as Error).message || '无法修改标注', 'error')
        throw error
      }
    },

    undoAnnotation: async (resourceId) => {
      try {
        return await annotationService.undo(resourceId)
      } catch (error) {
        get().notify((error as Error).message || '撤销失败', 'error')
        return false
      }
    },

    ensureFileResource: async (fileId) => {
      const file = get().files.find((f) => f.id === fileId)
      if (!file) return null
      try {
        const resource = await resourceRegistry.ensureResource({ kind: 'document', sourceId: file.id })
        return resource.id
      } catch {
        return null
      }
    },

    setReadingState: (resourceId, patch) => {
      set((s) => {
        const now = Date.now()
        const states = s.readingStates ?? {}
        const previous = states[resourceId] ?? createReadingState({ resourceId, now })
        return {
          readingStates: {
            ...states,
            [resourceId]: patchReadingState(previous, patch, now)
          }
        }
      })
      // Zoom, scroll ratio and annotation visibility are view state.
      persist(true)
    },
    // <<< integration:course-reading-annotation

    // >>> integration:note-capture-editing
    createNote: (title = '未命名笔记') => {
      const now = Date.now()
      const note: Note = { id: uid(), title, body: '', refs: [], createdAt: now, updatedAt: now }
      set((s) => ({
        notes: [note, ...s.notes],
        workspace: { ...s.workspace, activeNoteId: note.id, noteTabs: nextTabs(s.workspace.noteTabs, note.id) },
        noteBlocks: { ...s.noteBlocks, [note.id]: [] },
        notePositions: {
          ...s.notePositions,
          [note.id]: {
            noteId: note.id,
            docRevision: revisionOf(''),
            selection: { from: 0, to: 0 },
            scrollTop: 0,
            updatedAt: now
          }
        }
      }))
      persist()
      return note.id
    },

    selectNote: (id) => {
      set((s) => ({
        workspace: { ...s.workspace, activeNoteId: id, noteTabs: nextTabs(s.workspace.noteTabs, id) }
      }))
      persist()
    },
    // <<< integration:note-capture-editing

    updateNote: (id, patch) => {
      set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n))
      }))
      persist()
    },

    // >>> integration:note-capture-editing
    deleteNote: (id) => {
      const note = get().notes.find((item) => item.id === id)
      if (!note) return
      const deletedAt = Date.now()
      set((s) => {
        const notes = s.notes.filter((n) => n.id !== id)
        const activeNoteId = s.workspace.activeNoteId === id ? notes[0]?.id ?? null : s.workspace.activeNoteId
        return {
          notes,
          noteTrash: [{ ...note, deletedAt }, ...s.noteTrash],
          workspace: {
            ...s.workspace,
            activeNoteId,
            noteTabs: (s.workspace.noteTabs ?? []).filter((item) => item !== id)
          }
        }
      })
      persist()
      useNoteUi.getState().showUndo({ noteId: id, title: note.title || '未命名笔记', at: deletedAt })
    },

    restoreNote: (id) => {
      const trashed = get().noteTrash.find((item) => item.id === id)
      if (!trashed) return
      const { deletedAt: _deletedAt, ...note } = trashed
      set((s) => ({
        notes: [note, ...s.notes],
        noteTrash: s.noteTrash.filter((item) => item.id !== id),
        workspace: { ...s.workspace, activeNoteId: id, noteTabs: nextTabs(s.workspace.noteTabs, id) }
      }))
      persist()
      get().notify('已恢复笔记')
    },

    restoreLastDeleted: () => {
      const banner = useNoteUi.getState().undoBanner
      if (!banner) return
      get().restoreNote(banner.noteId)
      useNoteUi.getState().showUndo(null)
    },

    insertCapture: async (command) => {
      const state = get()
      const note = state.notes.find((item) => item.id === command.targetNoteId)
      if (!note) throw new Error('目标笔记不存在')
      await ensureResource({ kind: 'note', sourceId: note.id, title: note.title })
      const operationId = command.operationId ?? uid()
      const before = note.body
      const result = await get().transactions.run(operationId, (tx) =>
        noteInsert.insertCapture({ ...command, operationId }, tx)
      )
      const after = get().notes.find((item) => item.id === note.id)
      if (after) {
        noteSessions.acceptExternalChange(
          note.id,
          before,
          after.body,
          get().noteBlocks[note.id],
          get().notePositions[note.id],
          operationId
        )
      }
      useNoteUi.getState().setTargetNote(note.id)
      const committedPosition = get().notePositions[note.id]
      if (committedPosition?.selection) {
        useNoteUi.getState().requestCaret(note.id, committedPosition.selection.from)
      }
      return result
    },

    undoInsert: async (operationId) => {
      const committed = await get().transactions.run(`${operationId}:undo`, (tx) =>
        noteInsert.undo(operationId, tx)
      )
      if (!committed) return false
      noteSessions.forceBody(committed.noteId, committed.body, committed.blocks, committed.position)
      noteSessions.forgetOperation(committed.noteId, operationId)
      if (committed.position?.selection) {
        useNoteUi.getState().requestCaret(committed.noteId, committed.position.selection.from)
      }
      return true
    },

    undoNoteEdit: async (noteId) => {
      const entry = noteSessions.peekUndo(noteId)
      if (!entry) return
      if (entry.operationId) {
        const ok = await get().undoInsert(entry.operationId)
        if (!ok) {
          get().notify('这条插入记录已失效，无法撤销来源链接', 'error')
          return
        }
        noteSessions.commitUndo(noteId)
        return
      }
      const popped = noteSessions.commitUndo(noteId)
      if (!popped) return
      get().updateNote(noteId, { body: popped.body })
      noteSessions.setSelection(noteId, popped.selection.from, popped.selection.to)
      useNoteUi.getState().requestCaret(noteId, popped.selection.from)
    },

    redoNoteEdit: (noteId) => {
      const entry = noteSessions.redo(noteId)
      if (!entry) return
      get().updateNote(noteId, { body: entry.body })
      noteSessions.setSelection(noteId, entry.selection.from, entry.selection.to)
      useNoteUi.getState().requestCaret(noteId, entry.selection.from)
    },

    saveNotePosition: (noteId, position, blocks) => {
      set((state) => ({
        notePositions: { ...state.notePositions, [noteId]: position },
        noteBlocks: { ...state.noteBlocks, [noteId]: blocks }
      }))
      persist()
    },

    ensureResource: (ref) => ensureResource(ref),

    closeNoteTab: (id) => {
      set((s) => ({
        workspace: { ...s.workspace, noteTabs: (s.workspace.noteTabs ?? []).filter((item) => item !== id) }
      }))
      persist()
    },

    /** Legacy API: routes through the single insert command. */
    insertToNote: (noteId, markdown, refs = []) => {
      const id = noteId ?? get().createNote()
      if (!get().notes.some((n) => n.id === id)) return id
      const placement = capturePlacement(get().notePositions[id], get().noteBlocks[id] ?? [])
      void (async () => {
        try {
          const candidates: NoteSourceCandidate[] = []
          for (const ref of refs) {
            const file = get().files.find((item) => item.id === ref.fileId)
            if (!file) continue
            const resource = await ensureResource({ kind: 'document', sourceId: file.id, title: file.name })
            candidates.push({
              resourceId: resource.id,
              selector: { type: 'document-text', page: ref.page, quote: { exact: ref.quote } },
              relation: 'quotes',
              selected: true
            })
          }
          await get().insertCapture({
            targetNoteId: id,
            placement,
            contentMarkdown: markdown,
            sourceCandidates: candidates,
            operationId: uid()
          })
        } catch (error) {
          get().notify((error as Error).message || '插入失败', 'error')
        }
      })()
      return id
    },

    /** Legacy API: reader selection capture through the single insert command. */
    insertSelectionToNote: () => {
      const { selection, files } = get()
      if (!selection) return
      const file = files.find((f) => f.id === selection.fileId)
      if (!file) return
      const targetId = captureTargetNoteId(get().notes, get().workspace.activeNoteId, useNoteUi.getState().lastTargetNoteId)
      if (!targetId) {
        get().notify('先新建一份笔记', 'error')
        return
      }
      const label = sourceLabel(file.name, selection.page)
      const markdown = buildCaptureMarkdown({ quote: selection.text, label, withSource: true })
      const placement = capturePlacement(get().notePositions[targetId], get().noteBlocks[targetId] ?? [])
      const operationId = uid()
      set({ selection: null })
      void (async () => {
        try {
          const resource = await ensureResource({ kind: 'document', sourceId: file.id, title: file.name })
          const result = await get().insertCapture({
            targetNoteId: targetId,
            placement,
            contentMarkdown: markdown,
            sourceCandidates: [{
              resourceId: resource.id,
              selector: { type: 'document-text', page: selection.page, quote: { exact: selection.text } },
              relation: 'quotes',
              selected: true
            }],
            operationId
          })
          const title = get().notes.find((item) => item.id === targetId)?.title ?? '笔记'
          useNoteUi.getState().setFeedback({
            noteId: targetId,
            blockId: result.insertedBlockId,
            operationId,
            label: `已加入《${title}》`,
            at: Date.now()
          })
          useNoteUi.getState().flashInsert(targetId, result.insertedBlockId, result.insertedRange.from, result.insertedRange.to)
          get().notify('已加入笔记')
        } catch (error) {
          get().notify((error as Error).message || '插入失败', 'error')
        }
      })()
    },

    /** Legacy API: direct answer insert, kept for callers that bypass the draft. */
    insertAnswerToNote: (messageId) => {
      const message = get().messages.find((m) => m.id === messageId)
      if (!message) return
      const file = get().files.find((f) => f.id === message.fileId) ?? get().files.find((f) => f.id === get().workspace.activeTab)
      const targetId = captureTargetNoteId(get().notes, get().workspace.activeNoteId, useNoteUi.getState().lastTargetNoteId)
      if (!targetId) return
      const body = stripCiteMarkers(message.content)
      const citations = (message.citations ?? []).filter((citation) => citation.verified)
      const sourceLine = citations.length && file
        ? `\n\n[来源：${sourceLabel(file.name, citations[0].page)}](csref:NEW)`
        : ''
      const placement = capturePlacement(get().notePositions[targetId], get().noteBlocks[targetId] ?? [])
      void (async () => {
        try {
          const candidates: NoteSourceCandidate[] = []
          for (const citation of citations) {
            if (!file) break
            const resource = await ensureResource({ kind: 'document', sourceId: file.id, title: file.name })
            candidates.push({
              resourceId: resource.id,
              selector: { type: 'document-text', page: citation.page, quote: { exact: citation.quote } },
              relation: 'derived_from',
              selected: true
            })
          }
          await get().insertCapture({
            targetNoteId: targetId,
            placement,
            contentMarkdown: `${body}${sourceLine}`,
            sourceCandidates: candidates,
            operationId: uid()
          })
          get().notify('回答已加入笔记')
        } catch (error) {
          get().notify((error as Error).message || '插入失败', 'error')
        }
      })()
    },
    // <<< integration:note-capture-editing

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
      const connection = get().connections.find((c) => c.id === id)
      if (connection && presetOf(connection)?.modelList === 'api') await get().refreshModels(id, true)
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

    refreshSubscription: async (id) => {
      const result = await window.cs.subscriptionRefresh(id)
      await get().refreshAuth()
      get().notify(result.message, result.ok ? 'info' : 'error')
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

    refreshModels: async (id, quiet = false) => {
      const connection = get().connections.find((c) => c.id === id)
      if (!connection) return
      if (presetOf(connection)?.modelList === 'registry') {
        if (!quiet) get().notify('该服务不提供模型列表，使用内置目录', 'error')
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
        if (!quiet) get().notify(result.message, 'error')
        return
      }
      const models = mergeDiscovered(connection, result.models)
      const picked = reconcileEnabled(connection, models)
      set((s) => {
        const connections = s.connections.map((c) => (c.id === id
          ? { ...c, models, modelsFetchedAt: Date.now(), ...picked }
          : c))
        // The active pick may have been a retired model; follow the reconciled default.
        const retired = s.activeModel.connectionId === id &&
          !picked.enabledModelIds.includes(s.activeModel.modelId)
        return {
          connections,
          activeModel: retired && picked.defaultModelId
            ? { connectionId: id, modelId: picked.defaultModelId }
            : s.activeModel
        }
      })
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
      if (connection.protocol !== 'demo' && !authReady(connection)) {
        state.notify(
          connection.authMethod === 'api-key'
            ? '请先在模型服务中填写该服务的 API Key'
            : '请先在模型服务中完成该服务的授权',
          'error'
        )
        return
      }
      const page = state.workspace.pages[file.id] ?? 1
      const pages = textCache.get(file.id) ?? []
      const selection = state.selection && state.selection.fileId === file.id ? state.selection : null
      // >>> integration:course-reading-annotation
      const selectionDraft = selection?.draft ?? null
      // <<< integration:course-reading-annotation
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
      const started = await window.cs.startAI(reqId, {
        route: routeOf(connection, model),
        system: SYSTEM_PROMPT,
        messages: [...history, { role: 'user', content }],
        demoText
      })
      // >>> integration:course-reading-annotation
      // Only a message that actually started creates the asks_about relation.
      if (started && selectionDraft) {
        try {
          await createAsksAboutLink(
            { selection: selectionDraft, messageId: userMessage.id },
            {
              transactions,
              anchorService,
              linkService,
              resourceRegistry,
              now: () => Date.now(),
              nextId: () => uid()
            }
          )
        } catch {
          get().notify('问题已发送，但来源关系建立失败', 'error')
        }
      }
      // <<< integration:course-reading-annotation
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
