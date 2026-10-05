// Time-based retention over the event log. B1.4. Events older than the
// window archive to the cold target, then drop from the hot tables; nothing
// is deleted before its bytes land in the archive. Projections are derived,
// so they rebuild from hot plus archive. The Temporal schedule that invokes
// runRetention lands in B2.1; this module is the job body.
import type { ArchiveTarget } from './targets.js'
import {
  type Db,
  deleteEventsBySeq,
  readEventsOlderThan,
  type StoredEvent,
} from '../db/index.js'

export interface RetentionOptions {
  /** Archive events strictly older than this many days. */
  olderThanDays: number
  /** Max rows per run; the schedule repeats until caught up. */
  batchSize?: number
}

export interface RetentionResult {
  archived: number
  deleted: number
}

function archiveKey(partition: string, seq: number): string {
  return `events/${partition}/${seq}.json`
}

export async function runRetention(db: Db, target: ArchiveTarget, options: RetentionOptions): Promise<RetentionResult> {
  const batchSize = options.batchSize ?? 1_000
  const rows = await readEventsOlderThan(db, options.olderThanDays, batchSize)
  for (const row of rows) {
    const body = JSON.stringify(row)
    await target.write(archiveKey(row.partition, row.seq), body)
  }
  if (rows.length > 0) {
    await deleteEventsBySeq(
      db,
      rows.map((row) => row.seq),
    )
  }
  return { archived: rows.length, deleted: rows.length }
}

/** Reads archived events back for replay (hot readPartition + this). */
export async function readArchive(target: ArchiveTarget, partition: string): Promise<StoredEvent[]> {
  const keys = await target.list(`events/${partition}/`)
  const events: StoredEvent[] = []
  for (const key of keys) {
    const body = await target.read(key)
    if (body === undefined) continue
    events.push(JSON.parse(body) as StoredEvent)
  }
  return events.sort((a, b) => a.seq - b.seq)
}
