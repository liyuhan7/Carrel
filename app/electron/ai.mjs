// Request layer, adapted onto the Vercel AI SDK (Apache-2.0). The SDK owns
// streaming, message parts and usage; this module only maps a CourseSpace route
// (protocol + base URL + credential) onto a provider instance and fixes the
// auth headers subscription channels need.
import { streamText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

function apiBase (baseUrl, protocol) {
  const base = (baseUrl || '').replace(/\/$/, '')
  if (protocol === 'google-generate-content') return /\/v\d/.test(base) ? base : `${base}/v1beta`
  if (protocol === 'anthropic-messages') return /\/v1$/.test(base) ? base : `${base}/v1`
  if (protocol === 'openai-responses') return /chatgpt\.com/.test(base) || /\/v1$/.test(base) ? base : `${base}/v1`
  return base
}

// Subscription tokens are not the header the SDK sends by default; rewrite them.
function authFetch (route, auth) {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers)
    if (auth.headers && route.authMethod !== 'api-key') {
      if (route.protocol === 'anthropic-messages') headers.delete('x-api-key')
      if (route.protocol === 'google-generate-content') headers.delete('x-goog-api-key')
    }
    for (const [key, value] of Object.entries(auth.headers || {})) {
      if (value) headers.set(key, value)
    }
    return fetch(input, { ...init, headers })
  }
}

function createModel (route, auth) {
  const baseURL = apiBase(route.baseUrl, route.protocol)
  const options = {
    baseURL,
    apiKey: auth.credential,
    headers: auth.headers,
    fetch: authFetch(route, auth)
  }
  if (route.protocol === 'anthropic-messages') return createAnthropic(options)(route.modelId)
  if (route.protocol === 'google-generate-content') return createGoogleGenerativeAI(options)(route.modelId)
  if (route.protocol === 'openai-responses') return createOpenAI(options).responses(route.modelId)
  return createOpenAICompatible({ ...options, name: 'carrel' }).chatModel(route.modelId)
}

function toMessages (messages) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : message.content.map((part) => part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image', image: Buffer.from(part.data, 'base64'), mediaType: part.mediaType })
  }))
}

export async function streamChat ({ route, auth, system, messages, signal, onDelta }) {
  const result = streamText({
    model: createModel(route, auth),
    system,
    messages: toMessages(messages),
    abortSignal: signal,
    maxRetries: 0
  })
  for await (const delta of result.textStream) {
    if (delta) onDelta(delta)
  }
  const usage = await result.usage
  return { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }
}

function authHeaders (route, auth) {
  const headers = { ...(auth.headers || {}) }
  if (route.projectId) headers['x-goog-user-project'] = route.projectId
  if (route.protocol === 'google-generate-content' && route.authMethod === 'api-key') return headers
  if (route.authMethod === 'api-key' && route.protocol === 'anthropic-messages') {
    headers['x-api-key'] = auth.credential
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.authorization = `Bearer ${auth.credential}`
  }
  return headers
}

function modelsUrl (route, auth) {
  const base = apiBase(route.baseUrl, route.protocol)
  const url = new URL(`${base}/models`)
  if (route.protocol === 'google-generate-content' && route.authMethod === 'api-key') {
    url.searchParams.set('key', auth.credential)
    url.searchParams.set('pageSize', '200')
  }
  if (route.protocol === 'anthropic-messages') url.searchParams.set('limit', '1000')
  return url
}

async function fetchModels (route, auth) {
  const response = await fetch(modelsUrl(route, auth), { headers: authHeaders(route, auth) })
  if (!response.ok) throw new Error(statusMessage(response.status))
  const data = await response.json()
  if (route.protocol === 'google-generate-content') {
    return (data.models || []).map((item) => ({
      id: String(item.name || '').replace(/^models\//, ''),
      name: item.displayName
    })).filter((item) => item.id)
  }
  return (data.data || []).map((item) => ({ id: item.id, name: item.name || item.display_name }))
    .filter((item) => item.id)
}

function statusMessage (status) {
  const hints = {
    401: '凭证无效或已过期',
    403: '没有访问该模型的权限',
    404: '接口地址或模型不存在',
    429: '请求过于频繁或额度不足'
  }
  return hints[status] || `服务返回错误（HTTP ${status}）`
}

export async function listModels (route, auth) {
  return fetchModels(route, auth)
}

export async function testConnection (route, auth) {
  const models = await fetchModels(route, auth)
  if (models.length) return { ok: true, message: `连接成功，可用模型 ${models.length} 个` }
  return { ok: true, message: '连接成功' }
}
