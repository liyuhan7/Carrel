import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// pdf.js needs its CMap and standard-font assets as static files.
// Copy one file at a time: fs.cpSync recursive dies silently on this volume.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'node_modules/pdfjs-dist')

for (const dir of ['cmaps', 'standard_fonts']) {
  const from = resolve(source, dir)
  const to = resolve(root, 'public', dir)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  const names = readdirSync(from)
  for (const name of names) {
    copyFileSync(join(from, name), join(to, name))
  }
  console.log('[assets] ' + dir + ': ' + names.length + ' files')
}
