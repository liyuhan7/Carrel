import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { createServer } from 'vite'

const server = await createServer()
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : 5173
const url = `http://localhost:${port}`
console.log(`[dev] renderer ${url}`)

const startedAt = Date.now()
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, CS_DEV_URL: url }
})

let settled = false
async function finish (code, signal) {
  if (settled) return
  settled = true
  const alive = Date.now() - startedAt
  if (alive < 3000) {
    // main.cjs quits silently when requestSingleInstanceLock() fails, so an
    // instant exit with no output almost always means a stale instance is open.
    console.error(`[dev] Electron 在 ${alive}ms 内退出 (code=${code}, signal=${signal})，窗口没起来。`)
    console.error('[dev] 大概率是另一个 Carrel / electron.exe 还开着，占着单实例锁。')
    console.error('[dev] 查一下：Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select ProcessId,CommandLine')
  } else {
    console.log(`[dev] Electron 退出 (code=${code}, signal=${signal})`)
  }
  await server.close()
  process.exit(code ?? (signal ? 1 : 0))
}

child.on('error', (err) => {
  console.error('[dev] 无法启动 Electron:', err.message)
  finish(1, null)
})
child.on('close', (code, signal) => finish(code, signal))
process.on('SIGINT', () => child.kill())
