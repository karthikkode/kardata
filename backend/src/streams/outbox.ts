// Thread event streams over the outbox. B3.2. The resume token is the
// outbox seq: replay-then-tail guarantees no gap (catch-up re-select after
// LISTEN subscribes) and no duplex (every yielded frame advances the token).
//
// Snapshot-overflow rule: when the backlog past the token exceeds
// SNAPSHOT_THRESHOLD frames, the stream opens with one state frame carrying
// the current thread plus the latest token instead of replaying history.
// The client re-renders from the snapshot and tails from its token.
//
// Table access lives in backend/src/db/outbox.ts (B7.4); this module keeps
// the frame mapping and the generator mechanics.
import {
  type ConnectableDb,
  latestOutboxSeq,
  readOutboxBacklog,
  type OutboxRow,
  subscribeOutbox,
} from '../db/index.js'
import { getThread } from '../db/index.js'
import { toApiMessage, toApiThread } from '../threads/views.js'

export const SNAPSHOT_THRESHOLD = 200

export type StreamFrameType = 'message' | 'state' | 'delta' | 'reasoning' | 'tool' | 'finding' | 'error' | 'context-version' | 'approval' | 'work-progress' | 'compaction' | 'steering-consumption'

export interface StreamFrame {
  seq: number
  threadKey: string
  type: StreamFrameType
  at: string
  payload: unknown
}

function frameFromRow(row: OutboxRow): StreamFrame | undefined {
  const seq = Number(row.seq)
  const at = new Date(row.at).toISOString()
  if (row.type === 'message') {
    const payload = row.payload as { seq?: number; kind?: string; message?: unknown; at?: string }
    if (typeof payload.seq !== 'number' || typeof payload.kind !== 'string') return undefined
    const message = toApiMessage({
      seq: payload.seq,
      kind: payload.kind,
      payload: payload.message,
      at: typeof payload.at === 'string' ? payload.at : at,
    })
    if (!message) return undefined
    return { seq, threadKey: row.thread_key, type: 'message', at, payload: message }
  }
  if (row.type === 'state') {
    return { seq, threadKey: row.thread_key, type: 'state', at, payload: row.payload }
  }
  if (row.type === 'delta') {
    // Ephemeral token text: validated shape, passed through untouched. The
    // terminal message event supersedes deltas; reconnects replay from
    // persisted messages, never from these frames.
    const payload = row.payload as { runKey?: unknown; text?: unknown }
    if (typeof payload.text !== 'string' || typeof payload.runKey !== 'string') return undefined
    return { seq, threadKey: row.thread_key, type: 'delta', at, payload: { runKey: payload.runKey, text: payload.text } }
  }
  if (row.type === 'reasoning') {
    // Ephemeral thinking trace: same lifecycle as deltas, separate
    // channel so the client never mixes thinking into the reply text.
    const payload = row.payload as { runKey?: unknown; text?: unknown }
    if (typeof payload.text !== 'string' || typeof payload.runKey !== 'string') return undefined
    return { seq, threadKey: row.thread_key, type: 'reasoning', at, payload: { runKey: payload.runKey, text: payload.text } }
  }
  if (row.type === 'tool') {
    const payload = row.payload as { runKey?: unknown; id?: unknown; name?: unknown; state?: unknown }
    if (typeof payload?.runKey !== 'string' || typeof payload.id !== 'string' || typeof payload.name !== 'string') return undefined
    if (payload.state !== 'running' && payload.state !== 'done' && payload.state !== 'failed') return undefined
    return { seq, threadKey: row.thread_key, type: 'tool', at, payload: { runKey: payload.runKey, id: payload.id, name: payload.name, state: payload.state } }
  }
  if (['context-version', 'approval', 'work-progress', 'compaction', 'steering-consumption'].includes(row.type)) {
    return { seq, threadKey: row.thread_key, type: row.type as StreamFrame['type'], at, payload: row.payload }
  }
  return undefined
}

export async function* openThreadStream(
  pool: ConnectableDb,
  threadKey: string,
  fromSeq: number,
  signal?: AbortSignal,
): AsyncGenerator<StreamFrame> {
  let cursor = fromSeq
  // Bounded initial read: one row past the snapshot threshold is enough
  // to choose snapshot-vs-replay without loading a huge backlog.
  const backlog = await readOutboxBacklog(pool, threadKey, cursor, SNAPSHOT_THRESHOLD + 1)
  if (backlog.length > SNAPSHOT_THRESHOLD) {
    // Snapshot-overflow: one state frame with the live thread and the
    // latest token; history is skipped, the tail continues below.
    // Capture the token before the view: concurrent commits after this token
    // must remain in the tail even if they arrive while reading the snapshot.
    cursor = await latestOutboxSeq(pool, threadKey)
    const view = await getThread(pool, threadKey)
    if (view) {
      yield {
        seq: cursor,
        threadKey,
        type: 'state',
        at: new Date().toISOString(),
        payload: { ...toApiThread(view), historyRefresh: true },
      }
    }
  } else {
    for (const row of backlog) {
      const frame = frameFromRow(row)
      if (!frame) continue
      cursor = frame.seq
      yield frame
    }
  }

  const subscription = await subscribeOutbox(pool)
  try {
    const pending: string[] = []
    let wake: (() => void) | undefined
    subscription.onNotification((payload) => {
      if (payload !== undefined) pending.push(payload)
      wake?.()
    })
    for (;;) {
        if (signal?.aborted) return
        // Re-select on every wake (and once up front): notifications carry
        // only a seq, so the table is the source of truth and missed wakes
        // cannot gap the stream.
        pending.length = 0
        const fresh = await readOutboxBacklog(pool, threadKey, cursor)
        for (const row of fresh) {
          const frame = frameFromRow(row)
          if (!frame) continue
          cursor = frame.seq
          yield frame
        }
        if (signal?.aborted) return
        // A notify that landed mid-drain is already queued: loop instead of
        // waiting, or the stream stalls until the next event.
        if (pending.length > 0) continue
        await new Promise<void>((resolve) => {
          const done = (): void => {
            signal?.removeEventListener('abort', done)
            resolve()
          }
          wake = done
          signal?.addEventListener('abort', done, { once: true })
        })
        wake = undefined
    }
  } finally {
    await subscription.close()
  }
}
