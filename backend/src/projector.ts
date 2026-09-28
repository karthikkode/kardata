// Request-scoped projector. B3.1. No background worker: every read path
// calls projectNewEvents first, and the turn append activity calls it right
// after appending (the live tail learns about rows only through the outbox,
// and no read is guaranteed to follow a turn). Projection applies each
// event exactly once in batched transactions behind an advisory lock plus
// a high-water checkpoint (migration 0003). Concurrent callers serialize on
// the lock; the loser waits, then finds nothing new. Batches cap at 500
// rows per transaction and the call loops until caught up (back-to-back
// batches keep committing progress, so a slow reader still converges);
// MAX_BATCHES bounds one request (10k events) and reports caughtUp false
// when the backlog outruns it — the next read continues from the stored
// high-water mark, so staleness is bounded, never stuck.
//
// Transaction mechanics live in backend/src/db/checkpoints.ts and the event
// reads in backend/src/db/events.ts (B7.6); this module keeps the
// orchestration: catch up, project, store the high-water mark.
import {
  projectBatch,
  readEventsAfter,
  runCheckpointTx,
  type TransactableDb,
} from './db/index.js'

const CHECKPOINT = 'threads-v1'
const BATCH = 500
const MAX_BATCHES = 20

export interface ProjectorResult {
  applied: number
  caughtUp: boolean
}

export async function projectNewEvents(db: TransactableDb): Promise<ProjectorResult> {
  let applied = 0
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result = await runCheckpointTx(db, CHECKPOINT, async (tx) => {
      const from = await tx.checkpointSeq()
      const found = await readEventsAfter(tx, from, BATCH + 1)
      const rows = found.slice(0, BATCH)
      let count = 0
      if (rows.length > 0) {
        const projected = await projectBatch(tx, rows)
        count = projected.applied
        const last = rows[rows.length - 1]
        if (!last) throw new Error('projector: empty batch with rows present')
        await tx.storeCheckpointSeq(last.seq)
      }
      return { applied: count, caughtUp: found.length <= BATCH }
    })
    applied += result.applied
    if (result.caughtUp) return { applied, caughtUp: true }
  }
  return { applied, caughtUp: false }
}
