// Resource registration: map FileRec, Note and the AI conversation to stable
// Resource identities. Pure planning only; the runtime applies the plan inside
// one shared transaction.

import type { Resource, ResourceKind } from '../shared/contracts/content'
import type { ChatMessage, FileRec, Note, Session } from '../types'
import { derivedId, hashString } from './text.ts'

/** id used by the pre-session build and by callers that have no session yet. */
export const MAIN_CONVERSATION_ID = 'main'
export const CONVERSATION_TITLE = 'AI 学习会话'

export const RESOURCE_KINDS: ResourceKind[] = ['document', 'conversation', 'note']

export function resourceIdFor(kind: ResourceKind, sourceId: string): string {
  return derivedId('res', kind, sourceId)
}

export function documentRevision(file: FileRec): string {
  return file.hash ? `d:${file.hash}` : `m:${file.mtime}:${file.size}`
}

export function noteRevision(note: Note): string {
  return `n:${hashString(`${note.title}\n${note.body}`)}`
}

export function conversationRevision(messages: ChatMessage[]): string {
  const fingerprint = messages.map((message) => `${message.id}:${message.status ?? ''}:${message.content}`).join('\n')
  return `c:${hashString(fingerprint)}`
}

export function conversationResourceId(sessionId: string = MAIN_CONVERSATION_ID): string {
  return resourceIdFor('conversation', sessionId)
}

export interface ResourceSyncInput {
  resources: Record<string, Resource>
  files: FileRec[]
  notes: Note[]
  sessions?: Session[]
  messages: ChatMessage[]
  now?: number
}

export interface ResourceSyncPlan {
  /** Next resource slice. */
  resources: Record<string, Resource>
  /** Resources that were created or changed; empty means nothing to commit. */
  upserts: Resource[]
  bySource: {
    document: Map<string, string>
    conversation: Map<string, string>
    note: Map<string, string>
  }
}

export function planResourceSync(input: ResourceSyncInput): ResourceSyncPlan {
  const now = input.now ?? Date.now()
  const next: Record<string, Resource> = { ...input.resources }
  const upserts: Resource[] = []
  const bySource = {
    document: new Map<string, string>(),
    conversation: new Map<string, string>(),
    note: new Map<string, string>()
  }
  const existing = new Map<string, Resource>()
  for (const resource of Object.values(input.resources)) {
    existing.set(`${resource.kind}|${resource.sourceId}`, resource)
  }
  const desired = new Set<string>()

  const upsert = (
    kind: ResourceKind,
    sourceId: string,
    title: string,
    revision: string,
    availability: Resource['availability']
  ): Resource => {
    const key = `${kind}|${sourceId}`
    desired.add(key)
    const current = existing.get(key)
    if (current) {
      bySource[kind].set(sourceId, current.id)
      const changed =
        current.title !== title ||
        current.revision !== revision ||
        current.availability !== availability
      if (!changed) return current
      const updated: Resource = { ...current, title, revision, availability, updatedAt: now }
      next[current.id] = updated
      upserts.push(updated)
      return updated
    }
    const resource: Resource = {
      id: resourceIdFor(kind, sourceId),
      kind,
      sourceId,
      title,
      revision,
      createdAt: now,
      updatedAt: now,
      availability
    }
    next[resource.id] = resource
    upserts.push(resource)
    bySource[kind].set(sourceId, resource.id)
    return resource
  }

  for (const file of input.files) {
    upsert('document', file.id, file.name, documentRevision(file), file.missing ? 'missing' : 'available')
  }
  for (const note of input.notes) {
    upsert('note', note.id, note.title || '未命名笔记', noteRevision(note), 'available')
  }
  const conversationGroups = new Map<string, ChatMessage[]>()
  for (const message of input.messages) {
    const sessionId = message.sessionId || MAIN_CONVERSATION_ID
    const list = conversationGroups.get(sessionId)
    if (list) list.push(message)
    else conversationGroups.set(sessionId, [message])
  }
  const knownSessions = new Set<string>()
  for (const session of input.sessions ?? []) {
    knownSessions.add(session.id)
    const messages = conversationGroups.get(session.id) ?? []
    if (!messages.length && !existing.get(`conversation|${session.id}`)) continue
    upsert('conversation', session.id, session.title || CONVERSATION_TITLE, conversationRevision(messages), 'available')
  }
  for (const [sessionId, messages] of conversationGroups) {
    if (knownSessions.has(sessionId) || !messages.length) continue
    upsert('conversation', sessionId, CONVERSATION_TITLE, conversationRevision(messages), 'available')
  }

  // A registered resource whose source disappeared keeps its identity but is
  // marked deleted; snapshots on links stay untouched.
  for (const resource of Object.values(next)) {
    if (!RESOURCE_KINDS.includes(resource.kind)) continue
    if (desired.has(`${resource.kind}|${resource.sourceId}`)) continue
    if (resource.availability === 'deleted') continue
    const updated: Resource = { ...resource, availability: 'deleted', updatedAt: now }
    next[resource.id] = updated
    upserts.push(updated)
  }

  return { resources: next, upserts, bySource }
}
