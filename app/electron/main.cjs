'use strict'
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, clipboard, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const store = require('./store.cjs')
const ai = require('./ai.cjs')
const oauth = require('./oauth.cjs')
const subscriptions = require('./subscriptions.cjs')

const DIST = path.join(__dirname, '..', 'dist')
const DEV_URL = process.env.CS_DEV_URL

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

let mainWindow = null
let allowClose = false

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#eef0ee',
    title: 'Carrel',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadURL('app://carrel/index.html')
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault()
  })

  // Text fields need a native-feeling context menu; the default one is absent.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = []
    if (params.selectionText) items.push({ label: '复制', click: () => clipboard.writeText(params.selectionText) })
    if (params.isEditable) {
      items.push({ label: '剪切', role: 'cut' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' })
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow })
  })

  // Give the renderer a beat to persist the last keystroke before teardown.
  mainWindow.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    mainWindow.webContents.send('app:flush')
    setTimeout(() => {
      allowClose = true
      mainWindow?.close()
    }, 400)
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function registerIpc () {
  const authFor = async (route) => {
    if (route.authMethod === 'oauth') {
      const credential = await oauth.getAccessToken(route.connectionId)
      const headers = { authorization: `Bearer ${credential}` }
      if (route.projectId) headers['x-goog-user-project'] = route.projectId
      return { credential, headers }
    }
    if (route.authMethod === 'external-cli' || route.authMethod === 'copilot') {
      return subscriptions.getAuth(route)
    }
    return { credential: await store.getSecret(route.connectionId) }
  }

  const authSnapshot = async () => {
    const state = store.loadState()
    const auth = {}
    for (const item of state?.connections || state?.providers || []) {
      const [token, hasClient, subscription] = await Promise.all([
        oauth.status(item.id),
        oauth.hasClientSecret(item.id),
        subscriptions.status(item.id)
      ])
      auth[item.id] = {
        hasKey: store.hasSecret(item.id),
        hasOAuth: token.connected,
        hasOAuthClient: hasClient,
        oauthExpiresAt: token.expiresAt,
        hasSubscription: subscription.connected,
        subscriptionAccount: subscription.account,
        subscriptionExpiresAt: subscription.expiresAt
      }
    }
    return auth
  }

  ipcMain.handle('app:state', async () => ({
    state: store.loadState(),
    auth: await authSnapshot(),
    version: app.getVersion()
  }))
  ipcMain.handle('auth:state', () => authSnapshot())

  ipcMain.handle('app:save', (_event, state) => store.saveState(state))
  ipcMain.on('app:flushed', () => {
    allowClose = true
    mainWindow?.close()
  })

  ipcMain.handle('files:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入学习资料',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件', extensions: ['pdf', 'md', 'markdown', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'pptx', 'docx'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('files:probe', (_event, filePath) => store.probe(filePath))
  ipcMain.handle('files:readBytes', (_event, filePath) => fsp.readFile(filePath))
  ipcMain.handle('files:readText', (_event, filePath) => fsp.readFile(filePath, 'utf8'))
  ipcMain.handle('files:exists', (_event, paths) => {
    const missing = {}
    for (const p of paths) missing[p] = !fs.existsSync(p)
    return missing
  })
  ipcMain.handle('files:reveal', (_event, filePath) => shell.showItemInFolder(filePath))

  ipcMain.handle('files:saveText', (_event, fileId, pages) => {
    if (!/^[a-z0-9-]{8,64}$/i.test(fileId)) throw new Error('非法文件标识')
    return store.saveText(fileId, pages)
  })
  ipcMain.handle('files:getText', (_event, fileId) => {
    if (!/^[a-z0-9-]{8,64}$/i.test(fileId)) throw new Error('非法文件标识')
    return store.loadText(fileId)
  })

  ipcMain.handle('secret:set', (_event, id, key) => store.setSecret(id, key))
  ipcMain.handle('secret:clear', (_event, id) => store.clearSecret(id))
  ipcMain.handle('oauth:client', (_event, id, secret) => oauth.setClientSecret(id, secret))

  ipcMain.handle('models:list', async (_event, payload) => {
    const route = {
      connectionId: payload.connectionId,
      protocol: payload.protocol,
      baseUrl: payload.baseUrl,
      authMethod: payload.authMethod,
      projectId: payload.projectId,
      modelId: ''
    }
    try {
      const auth = payload.apiKey ? { credential: payload.apiKey } : await authFor(route)
      return await ai.listModels(route, auth)
    } catch (err) {
      return { ok: false, models: [], message: err?.message || '拉取模型失败' }
    }
  })

  ipcMain.handle('oauth:begin', async (_event, payload) => {
    try {
      const clientSecret = payload.clientSecret || (await oauth.getClientSecret(payload.connectionId))
      return await oauth.begin({
        connectionId: payload.connectionId,
        oauth: payload.oauth,
        clientId: payload.clientId,
        clientSecret
      })
    } catch (err) {
      return { ok: false, message: err?.message || '授权失败' }
    }
  })
  ipcMain.handle('oauth:signout', async (_event, id) => {
    await oauth.signout(id)
    return true
  })

  ipcMain.handle('subscription:detect', (_event, sources) => {
    const result = {}
    for (const source of sources || []) result[source] = subscriptions.detect(source)
    return result
  })
  ipcMain.handle('subscription:import', async (_event, connectionId, source) => {
    try {
      return await subscriptions.importFromCli(connectionId, source)
    } catch (err) {
      return { ok: false, message: err?.message || '导入失败' }
    }
  })
  ipcMain.handle('subscription:signout', async (_event, id) => {
    await subscriptions.signout(id)
    return true
  })
  ipcMain.handle('copilot:begin', async () => {
    try {
      return { ok: true, ...(await subscriptions.copilotBegin()) }
    } catch (err) {
      return { ok: false, message: err?.message || '无法开始 GitHub 登录' }
    }
  })
  ipcMain.handle('copilot:poll', async (_event, connectionId, deviceCode) => {
    try {
      return await subscriptions.copilotPoll(connectionId, deviceCode)
    } catch (err) {
      return { status: 'error', message: err?.message || 'Copilot 授权失败' }
    }
  })

  ipcMain.handle('ai:test', async (_event, payload) => {
    const auth = payload.apiKey
      ? { credential: payload.apiKey }
      : await authFor(payload.route).catch(() => null)
    return ai.testConnection(payload.route, auth)
  })

  ipcMain.handle('ai:start', (event, reqId, payload) => {
    const emit = (channel, data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data)
    }
    ai.start(reqId, payload, authFor, emit)
    return true
  })
  ipcMain.handle('ai:cancel', (_event, reqId) => ai.cancel(reqId))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('Carrel')

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    store.ensureDirs()
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url)
      const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
      const filePath = path.join(DIST, rel)
      if (!filePath.startsWith(DIST)) return new Response('Forbidden', { status: 403 })
      return net.fetch(pathToFileURL(filePath).toString())
    })
    // Local-only content: lock the renderer down to bundled assets.
    // Vite's dev server injects inline modules, so this only applies to the built app.
    if (!DEV_URL) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; worker-src 'self' blob:; connect-src 'self'"
            ]
          }
        })
      })
    }
    Menu.setApplicationMenu(null)
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
