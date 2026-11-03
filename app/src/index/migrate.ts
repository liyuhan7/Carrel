// Legacy NoteRef migration: every stored `NoteRef` becomes an Anchor pair plus
// one `quotes` ContentLink. The original `note.refs` array is never modified,
// ids are deterministic and the planner is idempotent, so the migration can run
// on every hydrate.

import type {
  Anchor,
  AnchorCreateInput,
  ContentLink,
  Resource
} from '../shared/contracts/content'
import type { FileRec, Note } from '../types'
import { documentRevision, noteRevision, resourceIdFor } from './resources.ts'
import { derivedId } from './text.ts'

export const MIGRATED_NOTE_ANCHOR_PREFIX = 'a1-note'
export const MIGRATED_REF_ANCHOR_PREFIX = 'a1-ref'
export const MIGRATED_REF_LINK_PREFIX = 'l1-ref'

export interface LegacyRefPlanInput {
  resources: Record<string, Resource>
  files: FileRec[]
  notes: Note[]
  anchors: Record<string, Anchor>
  links: Record<string, ContentLink>
  now?: number
}

export interface LegacyRefPlan {
  /** Next slices after the migration. */
  resources: Record<string, Resource>
  anchors: Record<string, Anchor>
  links: Record<string, ContentLink>
  /** Resources created or changed by this plan. */
  resourceUpserts: Resource[]
  /** Anchors and links that must exist afterwards (new or already present). */
  anchorInputs: AnchorCreateInput[]
  linkInputs: ContentLink[]
  createdResourceIds: string[]
  createdAnchorIds: string[]
  createdLinkIds: string[]
  /** Refs without a usable quote are kept as-is and not guessed at. */
  skippedRefIds: string[]
}

export function migratedNoteAnchorId(noteId: string): string {
  return derivedId(MIGRATED_NOTE_ANCHOR_PREFIX, noteId)
}

export function migratedRefAnchorId(noteId: string, refId: string): string {
  return derivedId(MIGRATED_REF_ANCHOR_PREFIX, noteId, refId)
}

export function migratedRefLinkId(noteId: string, refId: string): string {
  return derivedId(MIGRATED_REF_LINK_PREFIX, noteId, refId)
}

function ensureResource(
  input: LegacyRefPlanInput,
  index: Map<string, Resource>,
  kind: Resource['kind'],
  sourceId: string,
  title: string,
  revision: string,
  availability: Resource['availability'],
  now: number
): { resource: Resource; created: boolean } {
  const key = `${kind}|${sourceId}`
  const existing = index.get(key)
  if (existing) return { resource: existing, created: false }
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
  index.set(key, resource)
  input.resources[resource.id] = resource
  return { resource, created: true }
}

export function planLegacyRefMigration(input: LegacyRefPlanInput): LegacyRefPlan {
  const now = input.now ?? Date.now()
  const resources: Record<string, Resource> = { ...input.resources }
  const anchors: Record<string, Anchor> = { ...input.anchors }
  const links: Record<string, ContentLink> = { ...input.links }
  const resourceUpserts: Resource[] = []
  const anchorInputs: AnchorCreateInput[] = []
  const linkInputs: ContentLink[] = []
  const createdResourceIds: string[] = []
  const createdAnchorIds: string[] = []
  const createdLinkIds: string[] = []
  const skippedRefIds: string[] = []

  const index = new Map<string, Resource>()
  for (const resource of Object.values(resources)) index.set(`${resource.kind}|${resource.sourceId}`, resource)

  const trackResource = (resource: Resource, created: boolean, changed: boolean): void => {
    if (created) createdResourceIds.push(resource.id)
    if (created || changed) resourceUpserts.push(resource)
  }

  const addAnchor = (anchor: Anchor): void => {
    anchors[anchor.id] = anchor
    createdAnchorIds.push(anchor.id)
    anchorInputs.push({
      id: anchor.id,
      resourceId: anchor.resourceId,
      revision: anchor.accepted.revision,
      selector: anchor.accepted.selector,
      snapshot: anchor.snapshot
    })
  }

  for (const note of input.notes) {
    if (!note.refs?.length) continue

    const noteResource = ensureResource(
      { ...input, resources },
      index,
      'note',
      note.id,
      note.title || '未命名笔记',
      noteRevision(note),
      'available',
      now
    )
    trackResource(noteResource.resource, noteResource.created, false)

    const noteAnchorId = migratedNoteAnchorId(note.id)
    let noteAnchor = anchors[noteAnchorId]
    if (!noteAnchor) {
      noteAnchor = {
        id: noteAnchorId,
        resourceId: noteResource.resource.id,
        origin: { revision: noteRevision(note), selector: { type: 'resource' } },
        accepted: { revision: noteRevision(note), selector: { type: 'resource' } },
        snapshot: { label: note.title || '未命名笔记' },
        createdAt: now,
        updatedAt: now
      }
      addAnchor(noteAnchor)
    } else {
      anchorInputs.push({
        id: noteAnchor.id,
        resourceId: noteAnchor.resourceId,
        revision: noteAnchor.accepted.revision,
        selector: noteAnchor.accepted.selector,
        snapshot: noteAnchor.snapshot
      })
    }

    for (const ref of note.refs) {
      const quote = ref.quote?.trim()
      if (!quote) {
        skippedRefIds.push(ref.id)
        continue
      }
      const file = input.files.find((item) => item.id === ref.fileId)
      const revision = file ? documentRevision(file) : 'unknown'
      const availability: Resource['availability'] = file ? (file.missing ? 'missing' : 'available') : 'deleted'
      const documentResource = ensureResource(
        { ...input, resources },
        index,
        'document',
        ref.fileId,
        file?.name ?? ref.label ?? '未知资料',
        revision,
        availability,
        now
      )
      trackResource(documentResource.resource, documentResource.created, false)

      const targetAnchorId = migratedRefAnchorId(note.id, ref.id)
      let targetAnchor = anchors[targetAnchorId]
      if (!targetAnchor) {
        targetAnchor = {
          id: targetAnchorId,
          resourceId: documentResource.resource.id,
          origin: {
            revision,
            selector: { type: 'document-text', page: ref.page, quote: { exact: quote } }
          },
          accepted: {
            revision,
            selector: { type: 'document-text', page: ref.page, quote: { exact: quote } }
          },
          snapshot: { text: quote, label: ref.label },
          createdAt: ref.createdAt || now,
          updatedAt: now
        }
        addAnchor(targetAnchor)
      } else {
        anchorInputs.push({
          id: targetAnchor.id,
          resourceId: targetAnchor.resourceId,
          revision: targetAnchor.accepted.revision,
          selector: targetAnchor.accepted.selector,
          snapshot: targetAnchor.snapshot
        })
      }

      const linkId = migratedRefLinkId(note.id, ref.id)
      if (links[linkId]) continue
      const link: ContentLink = {
        id: linkId,
        fromAnchorId: noteAnchor.id,
        toAnchorId: targetAnchor.id,
        relation: 'quotes',
        createdBy: 'user',
        verification: 'unverified',
        createdAt: ref.createdAt || now,
        metadata: ref.label ? { note: ref.label } : undefined
      }
      links[linkId] = link
      linkInputs.push(link)
      createdLinkIds.push(linkId)
    }
  }

  return {
    resources,
    anchors,
    links,
    resourceUpserts,
    anchorInputs,
    linkInputs,
    createdResourceIds,
    createdAnchorIds,
    createdLinkIds,
    skippedRefIds
  }
}
