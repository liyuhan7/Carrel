// Resource identity: (kind, sourceId) maps to one stable Resource.id.
// Modules never concatenate ids or pass fileId/noteId as resourceId.

import type { Resource, ResourceRef, ResourceRegistry } from '../contracts/content'
import type { SharedDataPort } from './port'

export function createResourceRegistry(port: SharedDataPort): ResourceRegistry {
  const find = (ref: ResourceRef): Resource | undefined =>
    Object.values(port.read().resources).find(
      (resource) => resource.kind === ref.kind && resource.sourceId === ref.sourceId
    )

  return {
    async ensureResource(ref: ResourceRef & { title?: string }): Promise<Resource> {
      const existing = find(ref)
      if (existing) return existing

      const slices = port.read()
      const now = port.now()
      const resource: Resource = {
        id: port.nextId(),
        kind: ref.kind,
        sourceId: ref.sourceId,
        title: ref.title ?? ref.sourceId,
        revision: '0',
        createdAt: now,
        updatedAt: now,
        availability: 'available'
      }
      // The mapping is persisted before the id is handed out.
      port.write({ ...slices, resources: { ...slices.resources, [resource.id]: resource } })
      return resource
    },

    getResource(resourceId) {
      return port.read().resources[resourceId]
    }
  }
}
