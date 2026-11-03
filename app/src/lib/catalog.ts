import { bundledCatalog } from '@cherrystudio/provider-registry/data'
import type {
  AuthMethod, CredentialSource, InputModality, ModelCapability, ModelPreset,
  OAuthPreset, Protocol, ProviderPreset
} from '../types'

/**
 * Provider/model catalog adapted from @cherrystudio/provider-registry (MIT).
 * The registry owns provider endpoints, model ids and capabilities; CourseSpace
 * only adds the auth plumbing the registry deliberately leaves to the app.
 */

const CATALOG = bundledCatalog as unknown as {
  providers: { providers: readonly RegistryProvider[] }
  models: { models: readonly RegistryModel[] }
  providerModels: { overrides: readonly RegistryOverride[] }
}

interface RegistryProvider {
  id: string
  name: string
  defaultChatEndpoint: string | null
  modelListSource?: 'api' | 'registry'
  authMethods?: string[]
  endpointConfigs?: Record<string, { baseUrl?: string }>
}

interface RegistryModel {
  id: string
  name: string
  capabilities?: string[]
  inputModalities?: string[]
  contextWindow?: number
}

interface RegistryOverride {
  providerId: string
  modelId: string
  apiModelId?: string
  name?: string
  disabled?: boolean
  capabilities?: { add?: string[]; remove?: string[] }
  limits?: { contextWindow?: number }
  inputModalities?: string[]
}

const PROTOCOL_OF: Record<string, Protocol> = {
  'openai-chat-completions': 'openai-chat',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic-messages',
  'google-generate-content': 'google-generate-content'
}

/** Only these providers are offered; the registry ships 67. */
const CURATED = [
  'openai', 'anthropic', 'deepseek', 'zhipu', 'moonshot',
  'gemini', 'grok', 'openai-codex', 'claude-code', 'copilot'
]

const DISPLAY_NAME: Record<string, string> = {
  zhipu: '智谱 GLM',
  moonshot: 'Kimi',
  'openai-codex': 'ChatGPT 订阅（Codex）',
  'claude-code': 'Claude 订阅（Claude Code）',
  copilot: 'GitHub Copilot'
}

const AUTH_OVERRIDE: Record<string, AuthMethod[]> = {
  gemini: ['api-key', 'oauth'],
  'openai-codex': ['oauth', 'external-cli'],
  'claude-code': ['external-cli'],
  copilot: ['copilot']
}

const CLI_SOURCES: Record<string, CredentialSource[]> = {
  'openai-codex': ['codex'],
  'claude-code': ['claude-code']
}

/**
 * Official OAuth endpoints. Gemini's app flow is official; the Codex flow is
 * the one its open-source CLI uses and needs a user-supplied client id.
 */
const OAUTH: Record<string, OAuthPreset> = {
  gemini: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
    scopes: ['https://www.googleapis.com/auth/generative-language.retriever'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' }
  },
  'openai-codex': {
    authorizationEndpoint: 'https://auth.openai.com/oauth/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    extraAuthParams: { audience: 'https://api.openai.com/v1' }
  }
}

const CAPABILITY: Record<string, ModelCapability> = {
  'function-call': 'tools',
  reasoning: 'reasoning'
}

const modelById = new Map(CATALOG.models.models.map((model) => [model.id, model]))

function toModelPreset (providerId: string, override: RegistryOverride): ModelPreset | null {
  if (override.disabled) return null
  const base = modelById.get(override.modelId)
  const removed = new Set(override.capabilities?.remove ?? [])
  const raw = new Set([...(base?.capabilities ?? []), ...(override.capabilities?.add ?? [])])
  const capabilities = [...raw]
    .filter((item) => !removed.has(item))
    .map((item) => CAPABILITY[item])
    .filter(Boolean)
  const image = (override.inputModalities ?? base?.inputModalities ?? []).includes('image')
  const input: InputModality[] = image ? ['text', 'image'] : ['text']
  return {
    id: override.modelId,
    apiModelId: override.apiModelId,
    name: base?.name ?? override.name ?? override.modelId,
    contextWindow: override.limits?.contextWindow ?? base?.contextWindow,
    input,
    capabilities
  }
}

function buildPreset (provider: RegistryProvider): ProviderPreset | null {
  const protocol = provider.defaultChatEndpoint ? PROTOCOL_OF[provider.defaultChatEndpoint] : undefined
  if (!protocol) return null
  const baseUrl = provider.endpointConfigs?.[provider.defaultChatEndpoint!]?.baseUrl ?? ''
  const models = CATALOG.providerModels.overrides
    .filter((override) => override.providerId === provider.id)
    .map((override) => toModelPreset(provider.id, override))
    .filter((model): model is ModelPreset => Boolean(model))
  const auth = AUTH_OVERRIDE[provider.id] ??
    ((provider.authMethods ?? ['api-key']).map((method) => method === 'api-key' ? 'api-key' : method as AuthMethod))
  return {
    id: provider.id,
    name: DISPLAY_NAME[provider.id] ?? provider.name,
    protocol,
    baseUrl,
    auth,
    oauth: OAUTH[provider.id],
    sources: CLI_SOURCES[provider.id],
    copilot: provider.id === 'copilot',
    modelList: provider.modelListSource === 'registry' ? 'registry' : 'api',
    models
  }
}

export const CATALOG_PRESETS: ProviderPreset[] = CURATED
  .map((id) => CATALOG.providers.providers.find((provider) => provider.id === id))
  .filter((provider): provider is RegistryProvider => Boolean(provider))
  .map(buildPreset)
  .filter((preset): preset is ProviderPreset => Boolean(preset))
