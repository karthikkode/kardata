// Shared inbox-queue surface for sessionRun and subagentRun: waiting
// items list with stable ids and survive owner remove/reorder. The
// running item is already shifted, so it never appears.
import { defineQuery, defineUpdate } from '@temporalio/workflow'

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
