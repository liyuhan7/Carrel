// Shared state transaction: stage all domain writes, then commit once.
// A transaction is a staging context, not a database handle.

import type { StateTransaction, StateTransactionService } from '../contracts/content'
import type { SharedDataPort, SharedSlices } from './port'

export interface StagedTransaction extends StateTransaction {
  draft: SharedSlices
}

/** Reads through the transaction draft when one is present. */
export function draftOf(
  tx: StateTransaction | undefined,
  port: SharedDataPort
): SharedSlices {
  if (tx && 'draft' in tx) return (tx as StagedTransaction).draft
  return port.read()
}

export function createTransactionService(port: SharedDataPort): StateTransactionService {
  // Serialise transactions: one commit at a time, in call order.
  let queue: Promise<unknown> = Promise.resolve()

  return {
    run<T>(operationId: string, prepare: (tx: StateTransaction) => T): Promise<T> {
      const job = queue.then(async () => {
        const tx: StagedTransaction = {
          operationId,
          draft: structuredClone(port.read())
        }
        // `prepare` may return a value or a promise; a throw discards the draft.
        const result = await prepare(tx)
        port.write(tx.draft)
        return result
      })
      queue = job.then(
        () => undefined,
        () => undefined
      )
      return job
    }
  }
}
