'use strict'
// Subscription channels: credentials owned by another client (CLI logins) or
// by a consumer plan (GitHub Copilot). These are not official third-party APIs;
// they are opt-in, experimental, and may break when the upstream client
// changes. Tokens are imported into the encrypted store and never shown to the
// renderer.
//
// shortcut: imported CLI tokens are not refreshed — when they expire the user
// re-runs the CLI login and imports again. Add refresh when a stable, published
// client id exists for each CLI.

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

const CLI_SOURCES = {
  'claude-code': [path.join(home, '.claude', '.credentials.json')],
  codex: [path.join(home, '.codex', 'auth.json')]
}

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

/** Reads the CLI's own credential file without importing it. */
function detect (kind) {
  for (const file of CLI_SOURCES[kind] || []) {
    const data = readJson(file)
    if (!data) continue
    if (kind === 'claude-code') {
      const oauth = data.claudeAiOauth || data
      if (!oauth?.accessToken) continue
      return {
        found: true,
        file,
        account: oauth.subscriptionType ? `Claude ${oauth.subscriptionType}` : 'Claude 账号',
        expiresAt: oauth.expiresAt
      }
    }
    if (kind === 'codex') {
      const tokens = data.tokens || data
      if (!tokens?.access_token) continue
      const claims = decodeJwtPayload(tokens.id_token) || {}
      return {
        found: true,
        file,
        account: claims.email || tokens.account_id || 'ChatGPT 账号',
        expiresAt: undefined
      }
    }
  }
  return { found: false }
}

async function importFromCli (connectionId, kind) {
  const found = detect(kind)
  if (!found.found) throw new Error('没有找到本机登录信息，请先在该 CLI 中登录')
  const data = readJson(found.file)
  if (kind === 'claude-code') {
    const oauth = data.claudeAiOauth || data
    await store.setSecret(cliKey(connectionId), JSON.stringify({
      kind,
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      account: found.account
    }))
  } else {
    const tokens = data.tokens || data
    await store.setSecret(cliKey(connectionId), JSON.stringify({
      kind,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accountId: tokens.account_id,
      account: found.account
    }))
  }
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
  const expired = stored.expiresAt && stored.expiresAt < Date.now()
  return { connected: !expired, expired: Boolean(expired), account: stored.account, expiresAt: stored.expiresAt }
}

async function getAuth (route) {
  const stored = await readStored(route.connectionId)
  if (!stored?.accessToken) throw new Error('该服务尚未导入订阅凭证')
  if (stored.kind === 'copilot') return copilotAuth(stored)
  if (stored.expiresAt && stored.expiresAt < Date.now()) {
    throw new Error('订阅凭证已过期，请重新登录 CLI 后再导入')
  }
  if (stored.kind === 'claude-code') {
    return {
      credential: stored.accessToken,
      // Anthropic gates OAuth tokens on the official client's beta flag.
      headers: { 'anthropic-beta': 'oauth-2025-04-20' }
    }
  }
  return {
    credential: stored.accessToken,
    headers: {
      'chatgpt-account-id': stored.accountId || '',
      originator: 'codex_cli_rs',
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
  detect, importFromCli, status, getAuth, copilotBegin, copilotPoll, signout
}
