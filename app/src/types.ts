import type { Anchor, ContentLink, Resource } from './shared/contracts/content'

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
  /** True when the request carried a rendered page image. */
  withImage?: boolean
}

// ─── provider configuration ────────────────────────────────────────────────

export type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'google-generate-content' | 'demo'

export type AuthMethod = 'api-key' | 'oauth' | 'external-cli' | 'copilot' | 'none'

/** Local clients whose credential store we can import from. */
export type CredentialSource = 'claude-code' | 'codex'

export type InputModality = 'text' | 'image'

/** Capabilities the chat pipeline can actually act on today. */
export type ModelCapability = 'tools' | 'reasoning' | 'web-search'

export interface ModelPreset {
  id: string
  name: string
  /** Wire id when it differs from the catalog id. */
  apiModelId?: string
  contextWindow?: number
  input?: InputModality[]
  capabilities?: ModelCapability[]
}

/** OAuth endpoints for a provider that publishes an official app flow. */
export interface OAuthPreset {
  authorizationEndpoint: string
  tokenEndpoint: string
  revokeEndpoint?: string
  scopes: string[]
  /** Shipped public client id; empty means the user supplies their own. */
  clientId?: string
  /** Some providers still require the app secret at the token endpoint. */
  clientSecretRequired?: boolean
  extraAuthParams?: Record<string, string>
}

export interface ProviderPreset {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  auth: AuthMethod[]
  oauth?: OAuthPreset
  /** CLI credential stores this connection may import from. */
  sources?: CredentialSource[]
  /** GitHub Copilot device-flow login. */
  copilot?: boolean
  /** Where the model list comes from; registry-only providers skip the network. */
  modelList?: 'api' | 'registry'
  models: ModelPreset[]
}

/** One configured provider instance. The same preset can back several of them. */
export interface ProviderConnection {
  id: string
  presetId: string
  name: string
  protocol: Protocol
  baseUrl: string
  authMethod: AuthMethod
  oauthClientId?: string
  /** Google Cloud project used for OAuth quota (`x-goog-user-project`). */
  oauthProjectId?: string
  enabledModelIds: string[]
  defaultModelId?: string
  /** Credential state reported by the main process, never the secret itself. */
  hasKey?: boolean
  hasOAuth?: boolean
  hasOAuthClient?: boolean
  oauthExpiresAt?: number
  hasSubscription?: boolean
  subscriptionAccount?: string
  subscriptionExpiresAt?: number
  /** Models returned by the provider's list endpoint, merged with the catalog. */
  models?: ModelDescriptor[]
  modelsFetchedAt?: number
}

export interface ModelDescriptor {
  connectionId: string
  modelId: string
  apiModelId?: string
  displayName: string
  contextWindow?: number
  input: InputModality[]
  capabilities: ModelCapability[]
  provenance: 'preset' | 'discovered' | 'user'
}

export interface ActiveModel {
  connectionId: string
  modelId: string
}

/** What the main process needs to run one request. */
export interface ModelRoute {
  connectionId: string
  modelId: string
  protocol: Protocol
  baseUrl: string
  authMethod: AuthMethod
  /** Quota project for Google OAuth requests. */
  projectId?: string
}

// ─── requests ──────────────────────────────────────────────────────────────

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string | MessagePart[]
}

export interface AIPayload {
  route: ModelRoute
  system: string
  messages: AIMessage[]
  demoText?: string
}

export interface TestPayload {
  route: ModelRoute
  apiKey?: string
}

export interface ListModelsPayload {
  connectionId: string
  protocol: Protocol
  baseUrl: string
  authMethod: AuthMethod
  projectId?: string
  apiKey?: string
}

export interface RemoteModel {
  id: string
  name?: string
}

export interface OAuthBeginPayload {
  connectionId: string
  oauth: OAuthPreset
  clientId?: string
  clientSecret?: string
}

export interface ProviderAuthState {
  hasKey: boolean
  hasOAuth: boolean
  hasOAuthClient: boolean
  oauthExpiresAt?: number
  hasSubscription: boolean
  subscriptionAccount?: string
  subscriptionExpiresAt?: number
}

export interface SourceDetection {
  found: boolean
  account?: string
  expiresAt?: number
  file?: string
}

export interface DeviceCode {
  ok: boolean
  message?: string
  deviceCode?: string
  userCode?: string
  verificationUri?: string
  interval?: number
  expiresIn?: number
}

// ─── note rewrite ──────────────────────────────────────────────────────────

export interface RewriteState {
  reqId: string
  noteId: string
  start: number
  end: number
  original: string
  text: string
  status: 'streaming' | 'done' | 'error'
  error?: string
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
  /** Send a rendered page image along with the text when the model accepts it. */
  attachPageImage: boolean
}

export interface PersistedState {
  files: FileRec[]
  notes: Note[]
  annotations: Annotation[]
  messages: ChatMessage[]
  /** Unified content identity; see shared/contracts/content.ts. */
  resources: Record<string, Resource>
  /** Persisted positions referenced by annotations and links. */
  anchors: Record<string, Anchor>
  /** Explicit relations only; never inferred from similarity. */
  links: Record<string, ContentLink>
  connections: ProviderConnection[]
  activeModel: ActiveModel
  workspace: WorkspaceState
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
  getState(): Promise<{ state: PersistedState | null; auth: Record<string, ProviderAuthState>; version: string }>
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
  setOAuthClient(id: string, secret: string): Promise<void>
  authState(): Promise<Record<string, ProviderAuthState>>
  testProvider(payload: TestPayload): Promise<{ ok: boolean; message: string }>
  listModels(payload: ListModelsPayload): Promise<{ ok: boolean; models: RemoteModel[]; message: string }>
  oauthBegin(payload: OAuthBeginPayload): Promise<{ ok: boolean; message: string }>
  oauthSignout(id: string): Promise<void>
  subscriptionDetect(sources: CredentialSource[]): Promise<Record<string, SourceDetection>>
  subscriptionImport(id: string, source: CredentialSource): Promise<{ ok: boolean; message: string }>
  subscriptionSignout(id: string): Promise<void>
  copilotBegin(): Promise<DeviceCode>
  copilotPoll(id: string, deviceCode: string): Promise<{ status: 'pending' | 'ok' | 'error'; message?: string; account?: string }>
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
