'use strict'
// Local-first persistence: one JSON document plus per-file extracted text.
// shortcut: whole-state JSON instead of SQLite/FTS5 — fine for a personal library,
// upgrade when the library exceeds a few thousand files or needs full-text search.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')

const dir = () => app.getPath('userData')
const statePath = () => path.join(dir(), 'state.json')
const secretsPath = () => path.join(dir(), 'secrets.json')
const textsDir = () => path.join(dir(), 'texts')

function ensureDirs () {
  fs.mkdirSync(textsDir(), { recursive: true })
}

function readJSON (file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeAtomic (file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, data, 'utf8')
  await fsp.rename(tmp, file)
}

let queue = Promise.resolve()
function saveState (state) {
  queue = queue
    .then(() => writeAtomic(statePath(), JSON.stringify(state)))
    .catch((err) => { console.error('[store] save failed', err) })
  return queue
}

function loadState () {
  return readJSON(statePath(), null)
}

function hashFile (file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function probe (file) {
  const stat = await fsp.stat(file)
  return {
    path: file,
    name: path.basename(file),
    ext: path.extname(file).slice(1).toLowerCase(),
    size: stat.size,
    mtime: stat.mtimeMs,
    hash: await hashFile(file)
  }
}

// --- credentials ---------------------------------------------------------
// Keys never leave the main process. Renderer only learns whether one exists.
function loadSecrets () {
  return readJSON(secretsPath(), {})
}

function saveSecrets (secrets) {
  return writeAtomic(secretsPath(), JSON.stringify(secrets))
}

async function encryptionReady () {
  if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
    return safeStorage.isAsyncEncryptionAvailable()
  }
  return safeStorage.isEncryptionAvailable()
}

async function encrypt (value) {
  if (typeof safeStorage.encryptStringAsync === 'function') {
    return safeStorage.encryptStringAsync(value)
  }
  return safeStorage.encryptString(value)
}

async function decrypt (buffer) {
  if (typeof safeStorage.decryptStringAsync === 'function') {
    return safeStorage.decryptStringAsync(buffer)
  }
  return safeStorage.decryptString(buffer)
}

async function setSecret (id, key) {
  if (!(await encryptionReady())) throw new Error('系统安全存储不可用，无法保存密钥')
  const secrets = loadSecrets()
  secrets[id] = (await encrypt(key)).toString('base64')
  await saveSecrets(secrets)
}

async function getSecret (id) {
  const secrets = loadSecrets()
  if (!secrets[id] || !(await encryptionReady())) return null
  try {
    const value = await decrypt(Buffer.from(secrets[id], 'base64'))
    // Electron 45's async decrypt returns { result, shouldReEncrypt }.
    return typeof value === 'string' ? value : value?.result ?? null
  } catch {
    return null
  }
}

async function clearSecret (id) {
  const secrets = loadSecrets()
  delete secrets[id]
  await saveSecrets(secrets)
}

function hasSecret (id) {
  return Boolean(loadSecrets()[id])
}

// --- extracted document text -------------------------------------------
async function saveText (fileId, pages) {
  ensureDirs()
  await writeAtomic(path.join(textsDir(), `${fileId}.json`), JSON.stringify(pages))
}

function loadText (fileId) {
  return readJSON(path.join(textsDir(), `${fileId}.json`), null)
}

module.exports = {
  ensureDirs, loadState, saveState, probe, hashFile,
  setSecret, getSecret, clearSecret, hasSecret,
  saveText, loadText
}
