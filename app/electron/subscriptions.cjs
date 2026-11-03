'use strict'
// Subscription channels: credentials owned by another client (CLI logins) or
// by a consumer plan (GitHub Copilot). These are not official third-party APIs;
// they are opt-in, experimental, and may break when the upstream client
// changes. Tokens are imported into the encrypted store and never shown to the
// renderer.
//
// Credential import/refresh follows GCMP's CLI auth adapters (MIT): read the
// client's own token file, renew with its public OAuth client id when the token
// is close to expiry, and write the rotated token back so the CLI keeps working.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const store = require('./store.cjs')

const cliKey = (id) => `${id}::cli`
const home = os.homedir()

// Copilot's chat endpoint is served to first-party editors; this is VS Code's
// public device-flow client id, the same one other OSS clients use.
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const COPILOT_HEADERS = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Version': 'vscode/1.95.0',
  'X-Initiator': 'user'
}

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_VERSION = '0.164.0'
const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

function decodeJwtPayload (token) {
  try {
    const part = String(token).split('.')[1]
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomic (file, data) {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
  // Windows can hold the CLI's file open for a moment; retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(temp, file)
      return
    } catch (err) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code) || attempt >= 4) throw err
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)))
    }
  }
}

/** Picks the Grok Build record: canonical key first, then the x.ai namespace. */
function grokRecord (data) {
  const entries = Object.entries(data || {}).filter(([, value]) => value && typeof value === 'object')
  if (!entries.length) return null
  const canonical = `https://auth.x.ai::${GROK_CLIENT_ID}`
  return entries.find(([key]) => key === canonical) ||
    entries.find(([key]) => key.startsWith('https://auth.x.ai::')) ||
    entries[0]
}

/**
 * One adapter per local client: how to read its token file, renew the token and
 * write the rotation back. Mirrors GCMP's BaseCliAuth subclasses.
 */
const SOURCES = {
  'claude-code': {
    label: 'Claude Code',
    file: path.join(home, '.claude', '.credentials.json'),
    read (data) {
      const oauth = data.claudeAiOauth || data
      if (!oauth?.accessToken) return null
      return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt,
        account: oauth.subscriptionType ? `Claude ${oauth.subscriptionType}` : 'Claude 账号'
      }
    },
    write (data, token) {
      const target = data.claudeAiOauth || data
      target.accessToken = token.accessToken
      if (token.refreshToken) target.refreshToken = token.refreshToken
      if (token.expiresAt) target.expiresAt = token.expiresAt
      return data
    },
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    clientId: CLAUDE_CLIENT_ID,
    // Claude Code's token endpoint takes JSON, the OpenAI/xAI ones take a form body.
    tokenFormat: 'json'
  },
  codex: {
    label: 'Codex CLI',
    file: path.join(home, '.codex', 'auth.json'),
    read (data) {
      const tokens = data.tokens || data
      if (!tokens?.access_token) return null
      const claims = decodeJwtPayload(tokens.id_token) || {}
      const auth = claims['https://api.openai.com/auth'] || {}
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        // The access token is a JWT; fall back to the file's own timestamp.
        expiresAt: decodeJwtPayload(tokens.access_token)?.exp * 1000 ||
          (data.last_refresh ? Date.parse(data.last_refresh) + 23 * 60 * 60 * 1000 : undefined),
        accountId: tokens.account_id || auth.chatgpt_account_id,
        account: claims.email || tokens.account_id || 'ChatGPT 账号'
      }
    },
    write (data, token) {
      data.tokens = {
        ...data.tokens,
        access_token: token.accessToken,
        ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
        ...(token.idToken ? { id_token: token.idToken } : {})
      }
      data.last_refresh = new Date().toISOString()
      return data
    },
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: CODEX_CLIENT_ID
  },
  grok: {
    label: 'Grok Build',
    file: path.join(home, '.grok', 'auth.json'),
    read (data) {
      const found = grokRecord(data)
      if (!found) return null
      const [key, record] = found
      if (!record.key) return null
      return {
        accessToken: record.key,
        refreshToken: record.refresh_token,
        expiresAt: decodeJwtPayload(record.key)?.exp * 1000 ||
          (record.expires_at ? Date.parse(record.expires_at) : undefined),
        account: record.email || 'xAI 账号',
        clientId: record.oidc_client_id || GROK_CLIENT_ID,
        recordKey: key
      }
    },
    write (data, token) {
      const key = token.recordKey || `https://auth.x.ai::${token.clientId || GROK_CLIENT_ID}`
      data[key] = {
        ...data[key],
        key: token.accessToken,
        ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
        ...(token.expiresAt ? { expires_at: new Date(token.expiresAt).toISOString() } : {})
      }
      return data
    },
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    clientId: GROK_CLIENT_ID
  }
}

/** Reads the CLI's own credential file without importing it. */
function detect (kind) {
  const source = SOURCES[kind]
  if (!source) return { found: false }
  const data = readJson(source.file)
  const found = data ? source.read(data) : null
  if (!found) return { found: false }
  return { found: true, account: found.account, expiresAt: found.expiresAt }
}

async function importFromCli (connectionId, kind) {
  const source = SOURCES[kind]
  if (!source) throw new Error('不支持的本机登录来源')
  const found = detect(kind)
  if (!found.found) throw new Error('没有找到本机登录信息，请先在该 CLI 中登录')
  const data = readJson(source.file)
  const credentials = source.read(data)
  await store.setSecret(cliKey(connectionId), JSON.stringify({
    connectionId,
    kind,
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    idToken: credentials.idToken,
    accountId: credentials.accountId,
    clientId: credentials.clientId,
    recordKey: credentials.recordKey,
    expiresAt: credentials.expiresAt,
    account: credentials.account
  }))
  return { ok: true, message: `已导入 ${found.account}`, account: found.account }
}

async function readStored (connectionId) {
  const raw = await store.getSecret(cliKey(connectionId))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function status (connectionId) {
  const stored = await readStored(connectionId)
  if (!stored?.accessToken) return { connected: false }
  const expired = Boolean(stored.expiresAt && stored.expiresAt < Date.now())
  // Imported credentials count as connected even when expired: they are renewed
  // on the next request, or from the settings panel.
  return {
    connected: true,
    expired,
    account: stored.account,
    expiresAt: stored.expiresAt
  }
}

const refreshing = new Map()

/**
 * Renews an expired token and keeps both copies in sync: our store and the
 * client's file (only when the file still holds the token we just rotated).
 */
async function renew (connectionId, stored) {
  if (!stored?.refreshToken) throw new Error('凭证已过期且没有 refresh_token，请重新登录该 CLI 后再导入')
  const source = SOURCES[stored.kind]
  if (!source) throw new Error('不支持的本机登录来源')
  const form = {
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    client_id: stored.clientId || source.clientId
  }
  const response = await fetch(source.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': source.tokenFormat === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: source.tokenFormat === 'json' ? JSON.stringify(form) : new URLSearchParams(form)
  })
  const text = await response.text()
  let data = {}
  try {
    data = JSON.parse(text)
  } catch {
    // keep the raw text for the error message
  }
  if (!response.ok || !data.access_token) {
    throw new Error(`刷新凭证失败（HTTP ${response.status}）：${data.error_description || data.error?.message || text || '未知错误'}`)
  }
  const token = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || stored.refreshToken,
    idToken: data.id_token || stored.idToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : stored.expiresAt,
    clientId: stored.clientId,
    recordKey: stored.recordKey
  }
  const next = { ...stored, ...token }
  await store.setSecret(cliKey(connectionId), JSON.stringify(next))
  await writeBack(source, stored, token)
  return next
}

/** Updates the CLI's own file; skipped when another process rotated it first. */
async function writeBack (source, previous, token) {
  const data = readJson(source.file)
  if (!data) return
  const current = source.read(data)
  if (!current || (current.refreshToken && current.refreshToken !== previous.refreshToken)) return
  try {
    await writeJsonAtomic(source.file, source.write(data, token))
  } catch {
    // The imported copy still works; the CLI keeps its own file.
  }
}

async function freshStored (connectionId) {
  const stored = await readStored(connectionId)
  if (!stored?.accessToken) throw new Error('该服务尚未导入订阅凭证')
  // Copilot renews its short-lived token in copilotAuth().
  if (stored.kind === 'copilot') return stored
  if (!stored.expiresAt || stored.expiresAt > Date.now() + 60_000) return stored
  if (refreshing.has(connectionId)) return refreshing.get(connectionId)
  const task = renew(connectionId, stored).finally(() => refreshing.delete(connectionId))
  refreshing.set(connectionId, task)
  return task
}

async function refreshAuth (connectionId) {
  const stored = await readStored(connectionId)
  if (!stored?.accessToken) throw new Error('该服务尚未导入订阅凭证')
  if (stored.kind === 'copilot') {
    await copilotAuth(stored)
    return { ok: true, message: 'Copilot 授权已刷新' }
  }
  await renew(connectionId, stored)
  return { ok: true, message: '凭证已刷新' }
}

async function getAuth (route) {
  const stored = await freshStored(route.connectionId)
  if (stored.kind === 'copilot') return copilotAuth(stored)
  if (stored.kind === 'claude-code') {
    return {
      credential: stored.accessToken,
      // Anthropic gates OAuth tokens on the official client's beta flag.
      headers: { 'anthropic-beta': 'oauth-2025-04-20' }
    }
  }
  if (stored.kind === 'grok') return { credential: stored.accessToken }
  // The ChatGPT backend gates requests on the Codex CLI identity it knows:
  // originator + version headers and a matching user agent (see GCMP).
  const agent = `codex-tui/${CODEX_VERSION}`
  return {
    credential: stored.accessToken,
    headers: {
      'chatgpt-account-id': stored.accountId || '',
      originator: 'codex-tui',
      version: CODEX_VERSION,
      'user-agent': `${agent} (${process.platform === 'win32' ? 'Windows' : process.platform} ${os.release()}; ${process.arch === 'x64' ? 'x86_64' : process.arch}) codex_cli_rs/${CODEX_VERSION}`,
      'OpenAI-Beta': 'responses=experimental'
    }
  }
}

async function copilotAuth (stored) {
  let accessToken = stored.accessToken
  if (!stored.expiresAt || stored.expiresAt < Date.now() + 60000) {
    if (!stored.githubToken) throw new Error('Copilot 授权已过期，请重新登录')
    const fresh = await exchangeCopilotToken(stored.githubToken)
    accessToken = fresh.token
    await store.setSecret(cliKey(stored.connectionId), JSON.stringify({
      ...stored,
      accessToken,
      expiresAt: fresh.expires_at ? fresh.expires_at * 1000 : undefined
    }))
  }
  return { credential: accessToken, headers: COPILOT_HEADERS }
}

async function exchangeCopilotToken (githubToken) {
  const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: 'application/json',
      'user-agent': 'GitHubCopilotChat/0.22.0',
      'editor-version': 'vscode/1.95.0'
    }
  })
  if (!response.ok) throw new Error(`Copilot 授权失败（HTTP ${response.status}）`)
  return response.json()
}

async function copilotBegin () {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: COPILOT_CLIENT_ID, scope: 'read:user' })
  })
  if (!response.ok) throw new Error(`GitHub 设备授权失败（HTTP ${response.status}）`)
  const data = await response.json()
  if (!data.device_code) throw new Error(data.error_description || 'GitHub 没有返回设备码')
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval || 5,
    expiresIn: data.expires_in
  }
}

async function copilotPoll (connectionId, deviceCode) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })
  const data = await response.json()
  if (data.error === 'authorization_pending' || data.error === 'slow_down') return { status: 'pending' }
  if (data.error || !data.access_token) {
    return { status: 'error', message: data.error_description || data.error || 'GitHub 授权失败' }
  }

  const githubToken = data.access_token
  let account = 'GitHub 账号'
  try {
    const user = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${githubToken}`, accept: 'application/json', 'user-agent': 'Carrel' }
    })
    if (user.ok) account = (await user.json()).login || account
  } catch {
    // account label is cosmetic
  }
  const copilot = await exchangeCopilotToken(githubToken)
  await store.setSecret(cliKey(connectionId), JSON.stringify({
    connectionId,
    kind: 'copilot',
    accessToken: copilot.token,
    githubToken,
    expiresAt: copilot.expires_at ? copilot.expires_at * 1000 : undefined,
    account
  }))
  return { status: 'ok', account }
}

async function signout (connectionId) {
  await store.clearSecret(cliKey(connectionId))
}

module.exports = {
  detect, importFromCli, status, getAuth, refreshAuth, copilotBegin, copilotPoll, signout
}
