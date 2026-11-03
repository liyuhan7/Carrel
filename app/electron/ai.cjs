'use strict'
// CJS bridge to the ESM AI SDK runtime. Keys are resolved in main and never
// sent to the renderer.

const running = new Map()
let runtime

function load () {
  runtime ??= import('./ai.mjs')
  return runtime
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

async function start (reqId, payload, authFor, emit) {
  const controller = new AbortController()
  running.set(reqId, controller)
  const { route, system, messages, demoText } = payload
  let text = ''
  const onDelta = (delta) => {
    text += delta
    emit('ai:delta', { reqId, delta })
  }
  try {
    if (route.protocol === 'demo') {
      await streamDemo({ text: demoText || '演示模式没有可用的资料内容。', signal: controller.signal, onDelta })
    } else {
      const auth = await authFor(route)
      if (!auth?.credential) {
        throw new Error(route.authMethod === 'api-key' ? '该模型服务尚未配置 API Key' : '该服务尚未授权')
      }
      const { streamChat } = await load()
      await streamChat({ route, auth, system, messages, signal: controller.signal, onDelta })
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

async function listModels (route, auth) {
  try {
    if (route.protocol === 'demo') return { ok: false, models: [], message: '本地演示没有模型列表' }
    if (route.protocol !== 'openai-chat' && route.protocol !== 'anthropic-messages' &&
      route.protocol !== 'google-generate-content' && route.protocol !== 'openai-responses') {
      return { ok: false, models: [], message: '不支持的接口协议' }
    }
    if (!auth?.credential) {
      return { ok: false, models: [], message: route.authMethod === 'api-key' ? '请先填写 API Key' : '请先完成授权' }
    }
    const models = await (await load()).listModels(route, auth)
    return { ok: true, models, message: models.length ? `发现 ${models.length} 个模型` : '服务没有返回模型' }
  } catch (err) {
    return { ok: false, models: [], message: err?.message || '拉取模型失败' }
  }
}

async function testConnection (route, auth) {
  try {
    if (route.protocol === 'demo') return { ok: true, message: '本地演示不需要连接' }
    if (!auth?.credential) {
      return { ok: false, message: route.authMethod === 'api-key' ? '请先填写 API Key' : '请先完成授权' }
    }
    return await (await load()).testConnection(route, auth)
  } catch (err) {
    return { ok: false, message: `无法连接：${err?.message || '网络错误'}` }
  }
}

module.exports = { start, cancel, listModels, testConnection }
