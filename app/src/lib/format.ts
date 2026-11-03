export function formatBytes (bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime (ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function greeting (): string {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function truncate (text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function uid (): string {
  return crypto.randomUUID()
}
