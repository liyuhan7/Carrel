// Application state schema and migration seam.
// Owned by the unified data layer / integration owner. Modules provide their own
// migration functions; only this entry assigns schemaVersion and runs migrations in order.

export type { StateTransaction, StateTransactionService } from './content'

/**
 * Whole-application state format version. Not to be confused with
 * Resource.revision or a note docRevision. Modules must not bump or branch on it.
 */
export const SCHEMA_VERSION = 2

export interface Migration {
  from: number
  to: number
  /** Pure: returns a migrated copy, never mutates the input. */
  apply(state: Record<string, unknown>): Record<string, unknown>
}

/** Persisted document envelope written atomically by the data layer. */
export interface StateEnvelope<T = Record<string, unknown>> {
  schemaVersion: number
  data: T
}
