export type FileKind = 'pdf' | 'md' | 'image' | 'other'

export interface FileRec {
  id: string
  name: string
  path: string
  kind: FileKind
  ext: string
  size: number
  mtime: number
  hash: string
  addedAt: number
  lastOpenedAt: number
  pageCount: number
  favorite: boolean
  changed?: boolean
  missing?: boolean
}

/** [x, y, width, height] normalised to the page box (0..1). */
export type Rect = [number, number, number, number]

export interface Annotation {
  id: string
  fileId: string
  page: number
  rects: Rect[]
  text: string
  comment?: string
  createdAt: number
}

export interface NoteRef {
  id: string
  fileId: string
  page: number
  quote: string
  label: string
  createdAt: number
}

export interface Note {
  id: string
  title: string
  body: string
  refs: NoteRef[]
  createdAt: number
  updatedAt: number
}

export interface Citation {
  page: number
  quote: string
  verified: boolean
  corrected: boolean
}

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  citations?: Citation[]
  status?: MessageStatus
  providerName?: string
  model?: string
  contextLabel?: string
  fileId?: string
  page?: number
  error?: string
}

export type ProviderKind = 'openai' | 'anthropic' | 'demo'

export interface Provider {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  hasKey?: boolean
  builtin?: boolean
}

export type ContextScope = 'selection' | 'page' | 'file'

export interface WorkspaceState {
  tabs: string[]
  activeTab: string | null
  pages: Record<string, number>
  zoom: number
  activeNoteId: string | null
  contextScope: ContextScope
  readerPanel: 'doc' | 'ann'
}

export interface PersistedState {
  files: FileRec[]
  notes: Note[]
  annotations: Annotation[]
  messages: ChatMessage[]
  providers: Provider[]
  activeProviderId: string
  workspace: WorkspaceState
}

export const DEFAULT_PROVIDERS: Provider[] = [
  { id: 'demo', name: '演示模式', kind: 'demo', baseUrl: '', model: '本地演示', builtin: true },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', builtin: true },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', builtin: true },
  { id: 'glm', name: '智谱 GLM', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', builtin: true },
  { id: 'kimi', name: 'Kimi', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', builtin: true },
  { id: 'anthropic', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', builtin: true }
]

export interface AIPayload {
  provider: Provider
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  demoText?: string
}

export interface AIEvent {
  type: 'delta' | 'done' | 'error'
  reqId: string
  delta?: string
  text?: string
  message?: string
  stopped?: boolean
}

export interface Bridge {
  getState(): Promise<{ state: PersistedState | null; keys: Record<string, boolean>; version: string }>
  saveState(state: PersistedState): Promise<void>
  pickFiles(): Promise<string[]>
  probe(path: string): Promise<{ path: string; name: string; ext: string; size: number; mtime: number; hash: string }>
  readBytes(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  missing(paths: string[]): Promise<Record<string, boolean>>
  reveal(path: string): Promise<void>
  saveText(fileId: string, pages: string[]): Promise<void>
  getText(fileId: string): Promise<string[] | null>
  setKey(id: string, key: string): Promise<void>
  clearKey(id: string): Promise<void>
  testProvider(payload: { provider: Provider; apiKey?: string }): Promise<{ ok: boolean; message: string }>
  startAI(reqId: string, payload: AIPayload): Promise<boolean>
  cancelAI(reqId: string): Promise<void>
  onAI(cb: (event: AIEvent) => void): () => void
  onFlush(cb: () => void): void
  flushed(): void
  pathForFile(file: File): string
}

declare global {
  interface Window {
    cs: Bridge
  }
}
