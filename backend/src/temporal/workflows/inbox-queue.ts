// Shared inbox-queue surface for sessionRun and subagentRun: waiting
// items list with stable ids and survive owner remove/reorder. The
// running item is already shifted, so it never appears.
import { ApplicationFailure, defineQuery, defineUpdate, setHandler } from '@temporalio/workflow'

export interface QueueItemView {
  id: string
  text: string
  queuedAt: number
}

export const queueItemsQuery = defineQuery<QueueItemView[]>('queueItems')
export const queueRemoveUpdate = defineUpdate<boolean, [string]>('queueRemove')
export const queueReorderUpdate = defineUpdate<boolean, [string[]]>('queueReorder')

/** Normalize one inbox entry for reads. Pre-id entries (plain strings
 * or id-less objects from old histories) surface as legacy-<index>. */
export function normalizeQueueItem(item: unknown, index: number): QueueItemView {
  if (typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>)['id'] === 'string') {
    const record = item as Record<string, unknown>
    return {
      id: record['id'] as string,
      text: typeof record['text'] === 'string' ? (record['text'] as string) : '',
      queuedAt: typeof record['queuedAt'] === 'number' ? (record['queuedAt'] as number) : 0,
    }
  }
  const text = typeof item === 'string' ? item : typeof (item as Record<string, unknown> | null)?.['text'] === 'string' ? ((item as Record<string, unknown>)['text'] as string) : ''
  return { id: `legacy-${index}`, text, queuedAt: 0 }
}

/** Register the queue inspect/remove/reorder handlers over a live inbox
 * array. Shared by sessionRun and subagentRun (P2 dedup); entries are
 * objects, so the push guard is an undefined check, never truthiness. */
export function registerQueueHandlers(inbox: Array<unknown>): void {
  setHandler(queueItemsQuery, () => inbox.map((item, index) => normalizeQueueItem(item, index)))
  setHandler(queueRemoveUpdate, (id: string) => {
    const at = inbox.findIndex((item, index) => normalizeQueueItem(item, index).id === id)
    if (at < 0) return false
    inbox.splice(at, 1)
    return true
  })
  setHandler(queueReorderUpdate, (ids: string[]) => {
    const current = inbox.map((item, index) => normalizeQueueItem(item, index))
    const known = new Set(current.map((item) => item.id))
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
      throw ApplicationFailure.nonRetryable('Queue ids must exactly match the current queue.', 'QueueMismatch')
    }
    const byId = new Map(current.map((item, index) => [item.id, index] as const))
    const entries = inbox.slice()
    inbox.length = 0
    for (const id of ids) {
      const at = byId.get(id)
      const entry = at === undefined ? undefined : entries[at]
      if (entry !== undefined) inbox.push(entry)
    }
    return true
  })
}
