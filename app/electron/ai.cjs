'use strict'
// Provider adapters. Both dialects are streamed over SSE and normalised to
// {delta, done}. Keys are resolved here and never sent to the renderer.

const running = new Map()

function errorFor (res) {
  const hints = {
    401: 'API Key 无效或已过期',
    403: '没有访问该模型的权限',
    404: '接口地址或模型不存在，请检查 Base URL 与模型 ID',
    429: '请求过于频繁或额度不足'
  }
  return new Error(hints[res.status] || `服务返回错误（HTTP ${res.status}）`)
}

async function readSSE (res, onEvent, signal) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        onEvent(JSON.parse(payload))
      } catch {
        // keep-alive or partial frame
      }
    }
  }
}

async function streamOpenAI ({ provider, apiKey, system, messages, signal, onDelta }) {
  const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      temperature: 0.3,
      messages: [{ role: 'system', content: system }, ...messages]
    }),
    signal
  })
  if (!res.ok) throw errorFor(res)
  await readSSE(res, (evt) => {
    const delta = evt.choices?.[0]?.delta?.content
    if (delta) onDelta(delta)
  }, signal)
}

async function streamAnthropic ({ provider, apiKey, system, messages, signal, onDelta }) {
  const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 2048,
      stream: true,
      system,
      messages
    }),
    signal
  })
  if (!res.ok) throw errorFor(res)
  await readSSE(res, (evt) => {
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      onDelta(evt.delta.text)
    }
  }, signal)
}

function streamDemo ({ text, signal, onDelta }) {
  return new Promise((resolve) => {
    let i = 0
    const step = () => {
      if (signal.aborted) return resolve()
      const size = 6 + Math.floor(Math.random() * 10)
      onDelta(text.slice(i, i + size))
      i += size
      if (i >= text.length) return resolve()
      setTimeout(step, 18)
    }
    step()
  })
}

async function start (reqId, payload, getKey, emit) {
  const controller = new AbortController()
  running.set(reqId, controller)
  const { provider, system, messages, demoText } = payload
  let text = ''
  const onDelta = (delta) => {
    text += delta
    emit('ai:delta', { reqId, delta })
  }
  try {
    if (provider.kind === 'demo') {
      await streamDemo({ text: demoText || '演示模式没有可用的资料内容。', signal: controller.signal, onDelta })
    } else {
      const apiKey = await getKey(provider.id)
      if (!apiKey) throw new Error('该模型服务尚未配置 API Key')
      const args = { provider, apiKey, system, messages, signal: controller.signal, onDelta }
      if (provider.kind === 'anthropic') await streamAnthropic(args)
      else await streamOpenAI(args)
    }
    emit('ai:done', { reqId, text, stopped: controller.signal.aborted })
  } catch (err) {
    if (controller.signal.aborted) {
      emit('ai:done', { reqId, text, stopped: true })
    } else {
      emit('ai:error', { reqId, message: err?.message || '请求失败' })
    }
  } finally {
    running.delete(reqId)
  }
}

function cancel (reqId) {
  running.get(reqId)?.abort()
}

async function testConnection ({ provider, apiKey }) {
  const base = provider.baseUrl.replace(/\/$/, '')
  try {
    if (provider.kind === 'anthropic') {
      const res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: provider.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
      })
      if (!res.ok) return { ok: false, message: errorFor(res).message }
      return { ok: true, message: '连接成功' }
    }
    const res = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${apiKey}` }
    })
    if (res.ok) return { ok: true, message: '连接成功' }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: errorFor(res).message }
    }
    // Some compatible gateways do not expose /models; fall back to a tiny completion.
    const probe = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: provider.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    })
    if (!probe.ok) return { ok: false, message: errorFor(probe).message }
    return { ok: true, message: '连接成功' }
  } catch (err) {
    return { ok: false, message: `无法连接：${err?.message || '网络错误'}` }
  }
}

module.exports = { start, cancel, testConnection }
