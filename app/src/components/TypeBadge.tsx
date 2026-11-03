import type { FileKind } from '../types'

const LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  md: 'MD',
  image: 'IMG',
  other: 'FILE'
}

export function TypeBadge ({ kind, ext }: { kind: FileKind; ext?: string }) {
  const label = kind === 'other' && ext ? ext.toUpperCase().slice(0, 4) : LABEL[kind]
  return <span className={`type-badge type-${kind}`}>{label}</span>
}
