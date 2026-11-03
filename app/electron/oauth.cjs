'use strict'
// Official OAuth 2.0 for providers that publish an app flow. Only the
// authorization-code + PKCE (loopback) flow is implemented; tokens live in the
// encrypted credential store, never in state.json or the renderer.

const { shell } = require('electron')
const crypto = require('node:crypto')
const http = require('node:http')
const store = require('./store.cjs')

const CALLBACK_TIMEOUT = 180000
const tokenKey = (id) => `${id}::oauth`
const clientKey = (id) => `${id}::oauth-client`
const pending = new Map()

function base64url (buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pkce () {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

async function getToken (id) {
  const raw = await store.getSecret(tokenKey(id))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveToken (id, token) {
  return store.setSecret(tokenKey(id), JSON.stringify(token))
}

async function status (id) {
  const token = await getToken(id)
  return { connected: Boolean(token?.accessToken), expiresAt: token?.expiresAt }
}

async function begin ({ connectionId, oauth, clientId, clientSecret }) {
  if (!oauth?.authorizationEndpoint || !oauth?.tokenEndpoint) throw new Error('该服务没有配置 OAuth 端点')
  if (!clientId) throw new Error('请先填写 OAuth 客户端 ID')
  const { verifier, challenge } = pkce()
  const state = base64url(crypto.randomBytes(16))

  pending.get(connectionId)?.close()
  const server = http.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  pending.set(connectionId, server)
  const { port } = server.address()
  const redirectUri = `http://127.0.0.1:${port}/callback`

  const url = new URL(oauth.authorizationEndpoint)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', (oauth.scopes || []).join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  for (const [key, value] of Object.entries(oauth.extraAuthParams || {})) url.searchParams.set(key, value)

  const codePromise = new Promise((resolve, reject) => {
    const finish = (error, code) => {
      clearTimeout(timer)
      server.close()
      pending.delete(connectionId)
      if (error) reject(error)
      else resolve(code)
    }
    const timer = setTimeout(() => finish(new Error('登录超时，请重试')), CALLBACK_TIMEOUT)
    server.on('request', (request, response) => {
      const target = new URL(request.url, redirectUri)
      if (target.pathname !== '/callback') {
        response.writeHead(404).end()
        return
      }
      const denied = target.searchParams.get('error')
      const code = target.searchParams.get('code')
      const returnedState = target.searchParams.get('state')
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (denied || !code) {
        response.end('<h3>授权未完成</h3><p>可以关闭此页面，回到 Carrel。</p>')
        finish(new Error(`授权未完成：${denied || '没有返回 code'}`))
        return
      }
      if (returnedState !== state) {
        response.end('<h3>授权校验失败</h3><p>可以关闭此页面。</p>')
        finish(new Error('授权状态校验失败，请重试'))
        return
      }
      response.end('<h3>授权成功</h3><p>可以关闭此页面，回到 Carrel。</p>')
      finish(null, code)
    })
  })

  await shell.openExternal(url.toString())
  const code = await codePromise

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier
  })
  if (clientSecret) body.set('client_secret', clientSecret)
  const response = await fetch(oauth.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!response.ok) throw new Error(`换取授权失败（HTTP ${response.status}）`)
  const data = await response.json()
  if (!data.access_token) throw new Error('授权响应缺少 access_token')

  await saveToken(connectionId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenEndpoint: oauth.tokenEndpoint,
    revokeEndpoint: oauth.revokeEndpoint,
    clientId,
    clientSecret
  })
  return { ok: true, message: '授权成功' }
}

async function getAccessToken (id) {
  const token = await getToken(id)
  if (!token) throw new Error('该服务尚未登录')
  if (!token.expiresAt || token.expiresAt - 60000 > Date.now()) return token.accessToken
  if (!token.refreshToken) throw new Error('授权已过期，请重新登录')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: token.clientId
  })
  if (token.clientSecret) body.set('client_secret', token.clientSecret)
  const response = await fetch(token.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!response.ok) throw new Error('授权刷新失败，请重新登录')
  const data = await response.json()
  const next = {
    ...token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : token.expiresAt
  }
  await saveToken(id, next)
  return next.accessToken
}

async function signout (id) {
  const token = await getToken(id)
  if (token?.revokeEndpoint && token.accessToken) {
    try {
      await fetch(token.revokeEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token.accessToken })
      })
    } catch {
      // revocation is best-effort; the local token is removed regardless
    }
  }
  await store.clearSecret(tokenKey(id))
}

function setClientSecret (id, secret) {
  return store.setSecret(clientKey(id), secret)
}

async function hasClientSecret (id) {
  return Boolean(await store.getSecret(clientKey(id)))
}

async function getClientSecret (id) {
  return store.getSecret(clientKey(id))
}

module.exports = { begin, getAccessToken, signout, status, setClientSecret, hasClientSecret, getClientSecret }
