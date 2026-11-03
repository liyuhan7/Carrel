'use strict'
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('cs', {
  getState: () => ipcRenderer.invoke('app:state'),
  saveState: (state) => ipcRenderer.invoke('app:save', state),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  probe: (filePath) => ipcRenderer.invoke('files:probe', filePath),
  readBytes: (filePath) => ipcRenderer.invoke('files:readBytes', filePath),
  readText: (filePath) => ipcRenderer.invoke('files:readText', filePath),
  missing: (paths) => ipcRenderer.invoke('files:exists', paths),
  reveal: (filePath) => ipcRenderer.invoke('files:reveal', filePath),
  saveText: (fileId, pages) => ipcRenderer.invoke('files:saveText', fileId, pages),
  getText: (fileId) => ipcRenderer.invoke('files:getText', fileId),
  setKey: (id, key) => ipcRenderer.invoke('secret:set', id, key),
  clearKey: (id) => ipcRenderer.invoke('secret:clear', id),
  testProvider: (payload) => ipcRenderer.invoke('ai:test', payload),
  startAI: (reqId, payload) => ipcRenderer.invoke('ai:start', reqId, payload),
  cancelAI: (reqId) => ipcRenderer.invoke('ai:cancel', reqId),
  onAI: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('ai:delta', (_e, p) => handler(_e, { type: 'delta', ...p }))
    ipcRenderer.on('ai:done', (_e, p) => handler(_e, { type: 'done', ...p }))
    ipcRenderer.on('ai:error', (_e, p) => handler(_e, { type: 'error', ...p }))
    return () => {
      ipcRenderer.removeAllListeners('ai:delta')
      ipcRenderer.removeAllListeners('ai:done')
      ipcRenderer.removeAllListeners('ai:error')
    }
  },
  onFlush: (callback) => ipcRenderer.on('app:flush', callback),
  flushed: () => ipcRenderer.send('app:flushed'),
  pathForFile: (file) => webUtils.getPathForFile(file)
})
