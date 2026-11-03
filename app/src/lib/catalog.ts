import { bundledCatalog } from '@cherrystudio/provider-registry/data'
import type {
  AuthMethod, CredentialSource, InputModality, ModelCapability, ModelPreset,
  OAuthPreset, Protocol, ProviderPreset
} from '../types'
import { GCMP_PRESETS } from './catalog/gcmp.ts'

/**
 * Provider/model catalog adapted from @cherrystudio/provider-registry (MIT) and GCMP
 * (MIT). The registries own provider endpoints, model ids and capabilities; CourseSpace
 * only adds the auth plumbing they deliberately leave to the app.
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
  endpointTypes?: string[]
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

/**
 * Provider set and section order, mirroring GCMP's vendor coverage: subscription
 * logins first, then the direct vendors, then the coding-plan gateways.
 */
const CURATED: Array<[string, string]> = [
  ['openai-codex', '订阅通道'],
  ['grok-cli', '订阅通道'],
  ['claude-code', '订阅通道'],
  ['copilot', '订阅通道'],
  ['zhipu', '国内直连'],
  ['deepseek', '国内直连'],
  ['moonshot', '国内直连'],
  ['dashscope', '国内直连'],
  ['doubao', '国内直连'],
  ['minimax', '国内直连'],
  ['stepfun', '国内直连'],
  ['baidu-cloud', '国内直连'],
  ['longcat', '国内直连'],
  ['mimo', '国内直连'],
  ['openai', '海外直连'],
  ['anthropic', '海外直连'],
  ['gemini', '海外直连'],
  ['grok', '海外直连'],
  ['opencode', '套餐接入点'],
  ['clinepass', '套餐接入点'],
  ['commandcode', '套餐接入点'],
  ['hyper', '套餐接入点']
]

const DISPLAY_NAME: Record<string, string> = {
  zhipu: '智谱 GLM',
  moonshot: 'Kimi',
  dashscope: '阿里云百炼',
  doubao: '火山方舟',
  stepfun: '阶跃星辰',
  'baidu-cloud': '百度千帆',
  mimo: '小米 MiMo',
  opencode: 'OpenCode Go',
  'openai-codex': 'ChatGPT 订阅（Codex）',
  'grok-cli': 'Grok 订阅（Grok Build）',
  'claude-code': 'Claude 订阅（Claude Code）',
  copilot: 'GitHub Copilot'
}

const AUTH_OVERRIDE: Record<string, AuthMethod[]> = {
  gemini: ['api-key', 'oauth'],
  'openai-codex': ['oauth', 'external-cli'],
  'grok-cli': ['external-cli'],
  'claude-code': ['external-cli'],
  copilot: ['copilot']
}

const CLI_SOURCES: Record<string, CredentialSource[]> = {
  'openai-codex': ['codex'],
  'grok-cli': ['grok'],
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

/** Some providers expose several protocols; each model declares which ones it serves. */
function modelProtocol (types: string[] | undefined, fallback: Protocol): Protocol {
  const supported = (types ?? []).map((type) => PROTOCOL_OF[type]).filter(Boolean)
  if (!supported.length) return fallback
  return supported.includes(fallback) ? fallback : supported[0]
}

function toModelPreset (providerId: string, override: RegistryOverride, fallback: Protocol): ModelPreset | null {
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
  const protocol = modelProtocol(override.endpointTypes, fallback)
  return {
    id: override.modelId,
    apiModelId: override.apiModelId,
    name: base?.name ?? override.name ?? override.modelId,
    protocol: protocol === fallback ? undefined : protocol,
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
    .map((override) => toModelPreset(provider.id, override, protocol))
    .filter((model): model is ModelPreset => Boolean(model))
    .filter((model, index, list) => list.findIndex((item) => item.id === model.id) === index)
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

/** Registry-backed presets, in CURATED order and tagged with their sidebar section. */
const REGISTRY_PRESETS: ProviderPreset[] = CURATED.flatMap(([id, group]) => {
  const provider = CATALOG.providers.providers.find((item) => item.id === id)
  const preset = provider ? buildPreset(provider) : null
  return preset ? [{ ...preset, group }] : []
})

/** GCMP-only vendors: coding-plan endpoints and gateways the Cherry registry lacks. */
const GCMP_GROUP: Record<string, string> = {
  'tencent-token': '套餐接入点',
  'tencent-tokenhub': '套餐接入点',
  'tencent-token-enterprise': '套餐接入点',
  'xfyun-coding': '套餐接入点',
  'xfyun-token': '套餐接入点',
  antling: '国内直连'
}

const GCMP_ORDER = [
  'antling',
  'tencent-token', 'tencent-tokenhub', 'tencent-token-enterprise',
  'xfyun-coding', 'xfyun-token',
  'clinepass', 'commandcode', 'hyper'
]

const GCMP_BY_ID = new Map(GCMP_PRESETS.map((preset) => [preset.id, preset]))

const GCMP_ENTRIES: ProviderPreset[] = GCMP_ORDER.flatMap((id) => {
  const preset = GCMP_BY_ID.get(id)
  return preset ? [{ ...preset, group: GCMP_GROUP[id] ?? '套餐接入点' }] : []
})

const GROUP_ORDER = ['订阅通道', '国内直连', '海外直连', '套餐接入点']

/** All presets, ordered by section so the settings list reads like GCMP's. */
export const CATALOG_PRESETS: ProviderPreset[] = [...REGISTRY_PRESETS, ...GCMP_ENTRIES]
  .sort((a, b) => GROUP_ORDER.indexOf(a.group ?? '') - GROUP_ORDER.indexOf(b.group ?? ''))
