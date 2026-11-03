// Persistence port for the shared content services.
// The data layer (store wiring) implements this; services never touch storage directly.

import type { Anchor, ContentLink, Resource } from '../contracts/content'

export interface SharedSlices {
  resources: Record<string, Resource>
  anchors: Record<string, Anchor>
  links: Record<string, ContentLink>
}

export interface SharedDataPort {
  read(): SharedSlices
  /** Writes the committed slices back through the data layer (persist + notify). */
  write(next: SharedSlices): void
  /** True when an Annotation or another formal object still uses the anchor. */
  isAnchorUsed(anchorId: string): boolean
  now(): number
  nextId(): string
}
