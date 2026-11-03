import type {
  ActiveModel, ModelCapability, ModelDescriptor, ModelRoute, ModelPreset, PersistedState,
  Protocol, ProviderConnection, ProviderPreset, RemoteModel, WorkspaceState
} from '../types'
import { CATALOG_PRESETS } from './catalog.ts'

/**
 * Provider registry. Presets ship with the app and carry no user data; a
 * connection is the user's instance of one. The split follows Cherry Studio's
 * provider-registry (preset catalog / user config / runtime route) without its
 * AGPL code or its much larger schema.
 */

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  'openai-chat': 'OpenAI 兼容',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-generate-content': 'Google Gemini',
  demo: '本地演示'
}

export const CAPABILITY_LABEL: Record<ModelCapability, string> = {
  tools: '工具调用',
  reasoning: '推理',
  'web-search': '联网搜索'
}

const TEXT: ModelDescriptor['input'] = ['text']

export const DEMO_PRESET: ProviderPreset = {
  id: 'demo',
  name: '演示模式',
  protocol: 'demo',
  baseUrl: '',
  group: '本地',
  auth: ['none'],
  modelList: 'registry',
  models: [{ id: 'demo', name: '本地演示' }]
}

/** Curated provider catalog (endpoints + models) adapted from Cherry Studio's registry. */
export const PRESETS: ProviderPreset[] = [DEMO_PRESET, ...CATALOG_PRESETS]

export const CUSTOM_PRESET_ID = 'custom'

/** Template for user-added endpoints; never listed as a provider on its own. */
export const CUSTOM_PRESET: ProviderPreset = {
  id: CUSTOM_PRESET_ID,
  name: '自定义服务',
  protocol: 'openai-chat',
  baseUrl: '',
  auth: ['api-key'],
  models: []
}

/** How many catalog models a new connection enables; the rest stay one toggle away. */
const DEFAULT_ENABLED = 8

export function connectionFromPreset (preset: ProviderPreset): ProviderConnection {
  const modelIds = preset.models.slice(0, DEFAULT_ENABLED).map((model) => model.id)
  return {
    id: preset.id,
    presetId: preset.id,
    name: preset.name,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    authMethod: preset.auth[0] ?? 'api-key',
    enabledModelIds: modelIds,
    defaultModelId: modelIds[0]
  }
}

export const DEFAULT_CONNECTIONS: ProviderConnection[] = PRESETS.map(connectionFromPreset)
export const DEFAULT_ACTIVE_MODEL: ActiveModel = { connectionId: 'demo', modelId: 'demo' }

export function presetOf (connection: ProviderConnection): ProviderPreset | undefined {
  return PRESETS.find((preset) => preset.id === connection.presetId) ??
    (connection.presetId === CUSTOM_PRESET_ID ? CUSTOM_PRESET : undefined)
}

export function describeModel (connection: ProviderConnection, modelId: string): ModelDescriptor {
  const preset: ModelPreset | undefined = presetOf(connection)?.models.find((model) => model.id === modelId)
  const cached = connection.models?.find((model) => model.modelId === modelId)
  return {
    connectionId: connection.id,
    modelId,
    apiModelId: preset?.apiModelId ?? cached?.apiModelId,
    displayName: preset?.name ?? cached?.displayName ?? modelId,
    protocol: preset?.protocol ?? cached?.protocol,
    contextWindow: preset?.contextWindow ?? cached?.contextWindow,
    input: preset?.input ?? cached?.input ?? TEXT,
    capabilities: preset?.capabilities ?? cached?.capabilities ?? [],
    provenance: preset ? 'preset' : cached?.provenance ?? 'user'
  }
}

export function enabledModels (connection: ProviderConnection): ModelDescriptor[] {
  return connection.enabledModelIds.filter(Boolean).map((modelId) => describeModel(connection, modelId))
}

/** Preset catalog plus whatever the provider's list endpoint returned, preset metadata first. */
export function modelRows (connection: ProviderConnection): ModelDescriptor[] {
  const rows: ModelDescriptor[] = []
  const seen = new Set<string>()
  const push = (model: ModelDescriptor) => {
    if (seen.has(model.modelId)) return
    seen.add(model.modelId)
    rows.push(model)
  }
  for (const model of presetOf(connection)?.models ?? []) push(describeModel(connection, model.id))
  for (const model of connection.models ?? []) push(describeModel(connection, model.modelId))
  for (const modelId of connection.enabledModelIds) push(describeModel(connection, modelId))
  return rows
}

export function mergeDiscovered (connection: ProviderConnection, remote: RemoteModel[]): ModelDescriptor[] {
  return remote.map((item) => {
    const preset = presetOf(connection)?.models.find((model) => model.id === item.id)
    return {
      connectionId: connection.id,
      modelId: item.id,
      apiModelId: preset?.apiModelId ?? item.id,
      displayName: preset?.name ?? item.name ?? item.id,
      protocol: preset?.protocol,
      contextWindow: preset?.contextWindow,
      input: preset?.input ?? TEXT,
      capabilities: preset?.capabilities ?? [],
      provenance: preset ? 'preset' : 'discovered'
    }
  })
}

export interface ModelOption {
  connection: ProviderConnection
  model: ModelDescriptor
}

export function modelOptions (connections: ProviderConnection[]): ModelOption[] {
  return connections.flatMap((connection) => enabledModels(connection).map((model) => ({ connection, model })))
}

export interface ActiveRoute {
  connection: ProviderConnection
  model: ModelDescriptor
}

/** Resolves the current selection; falls back to the connection's default or first enabled model. */
export function activeRoute (connections: ProviderConnection[], active: ActiveModel | null | undefined): ActiveRoute | null {
  const connection = connections.find((item) => item.id === active?.connectionId)
  if (!connection) return null
  const models = enabledModels(connection)
  const model = models.find((item) => item.modelId === active?.modelId) ??
    models.find((item) => item.modelId === connection.defaultModelId) ??
    models[0]
  return model ? { connection, model } : null
}

export function routeOf (connection: ProviderConnection, model: ModelDescriptor): ModelRoute {
  return {
    connectionId: connection.id,
    modelId: model.apiModelId ?? model.modelId,
    protocol: model.protocol ?? connection.protocol,
    baseUrl: connection.baseUrl,
    authMethod: connection.authMethod,
    projectId: connection.oauthProjectId
  }
}

export function authReady (connection: ProviderConnection): boolean {
  if (connection.authMethod === 'none') return true
  if (connection.authMethod === 'oauth') return Boolean(connection.hasOAuth)
  if (connection.authMethod === 'external-cli' || connection.authMethod === 'copilot') {
    return Boolean(connection.hasSubscription)
  }
  return Boolean(connection.hasKey)
}

export function authLabel (connection: ProviderConnection): string {
  if (connection.authMethod === 'none') return '无需凭证'
  if (connection.authMethod === 'oauth') {
    if (connection.hasOAuth) return '账号已授权'
    return '未登录'
  }
  return connection.hasKey ? '已保存密钥' : '未配置密钥'
}

export function supportsImage (model: ModelDescriptor | null | undefined): boolean {
  return Boolean(model?.input.includes('image'))
}

interface LegacyProvider {
  id: string
  name: string
  kind: 'openai' | 'anthropic' | 'demo'
  baseUrl: string
  model: string
}

type SavedState = Partial<PersistedState> & {
  providers?: LegacyProvider[]
  activeProviderId?: string
  workspace?: WorkspaceState
}

/** Accepts both older state shapes: `providers`/`activeProviderId`, and v1 connections without auth/model fields. */
export function adoptSaved (saved: SavedState | null | undefined): {
  connections: ProviderConnection[]
  activeModel: ActiveModel
} {
  if (saved?.connections?.length) {
    const savedConnections = saved.connections.map(normalizeConnection)
    const known = new Set(savedConnections.map((connection) => connection.id))
    // The catalog grows between releases; offer new presets without touching saved ones.
    const added = DEFAULT_CONNECTIONS.filter((connection) => !known.has(connection.id))
    const connections = [...savedConnections, ...added]
    const resolved = saved.activeModel ? activeRoute(connections, saved.activeModel) : null
    return {
      connections,
      activeModel: resolved
        ? { connectionId: resolved.connection.id, modelId: resolved.model.modelId }
        : fallbackActive(connections)
    }
  }
  if (saved?.providers?.length) {
    const migrated = saved.providers.map(legacyConnection)
    const known = new Set(migrated.map((connection) => connection.id))
    const connections = [...migrated, ...DEFAULT_CONNECTIONS.filter((connection) => !known.has(connection.id))]
    const picked = connections.find((item) => item.id === saved.activeProviderId)
    return {
      connections,
      activeModel: picked
        ? { connectionId: picked.id, modelId: picked.defaultModelId ?? picked.enabledModelIds[0] }
        : fallbackActive(connections)
    }
  }
  return { connections: DEFAULT_CONNECTIONS, activeModel: DEFAULT_ACTIVE_MODEL }
}

function normalizeConnection (connection: ProviderConnection): ProviderConnection {
  const preset = presetOf(connection)
  return {
    ...connection,
    protocol: connection.protocol ?? preset?.protocol ?? 'openai-chat',
    authMethod: connection.authMethod ?? preset?.auth[0] ?? 'api-key',
    enabledModelIds: connection.enabledModelIds ?? [],
    models: connection.models
  }
}

function legacyConnection (provider: LegacyProvider): ProviderConnection {
  const protocol: Protocol = provider.kind === 'demo'
    ? 'demo'
    : provider.kind === 'anthropic' ? 'anthropic-messages' : 'openai-chat'
  const fallbackId = PRESETS.find((preset) => preset.id === provider.id)?.models[0]?.id || ''
  const modelId = protocol === 'demo' ? 'demo' : provider.model || fallbackId
  return {
    id: provider.id,
    presetId: provider.id,
    name: provider.name,
    protocol,
    baseUrl: provider.baseUrl,
    authMethod: protocol === 'demo' ? 'none' : 'api-key',
    enabledModelIds: [modelId],
    defaultModelId: modelId
  }
}

function fallbackActive (connections: ProviderConnection[]): ActiveModel {
  for (const connection of connections) {
    const [model] = enabledModels(connection)
    if (model) return { connectionId: connection.id, modelId: model.modelId }
  }
  return DEFAULT_ACTIVE_MODEL
}
