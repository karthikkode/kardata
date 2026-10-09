// Thread API: thread lists, message pages, queue, receipts, operations.
import { z } from 'zod'
import { request, requestEnvelope, requestValidated, StagingApiError, type StagingConfig } from './client'

export interface ThreadView {
  name?: string
  key: string
  sessionId: string
  kind: string
  status: string
  stateReason?: string
  acceptingSteer: boolean
  queueDepth: number
  updatedAt: string
}

export function listThreads(config: StagingConfig, sessionId: string): Promise<ThreadView[]> {
  return request<ThreadView[]>(
    config,
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}/threads`,
  )
}

/** Drain bounded REST pages, including pages containing only hidden launch notices.
 * Cursor metadata is authoritative; message count is not a paging boundary. */
export async function listMessages(
  config: StagingConfig,
  threadKey: string,
  afterSeq = 0,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const messages: unknown[] = []
  let cursor = afterSeq
  for (;;) {
    const page = await requestEnvelope<unknown[]>(config, 'GET',
      `/v1/threads/${encodeURIComponent(threadKey)}/messages?afterSeq=${cursor}&limit=200`, undefined, signal)
    messages.push(...page.data)
    if (page.nextAfterSeq === undefined || page.nextAfterSeq === cursor) return messages
    if (!Number.isSafeInteger(page.nextAfterSeq) || page.nextAfterSeq < cursor) {
      throw new StagingApiError(200, 'invalid_response', 'Message cursor did not advance safely.')
    }
    cursor = page.nextAfterSeq
  }
}

const SteeringReceiptPage = z.object({ items: z.array(z.object({ id: z.string(), state: z.enum(['consumed', 'missed']) })), nextAfterId: z.string().nullable() })
export async function readSteeringReceipts(config: StagingConfig, threadKey: string, signal?: AbortSignal) {
  const items: Array<{ id: string; state: 'consumed' | 'missed' }> = []
  let afterId = ''
  for (;;) {
    const { data } = await requestEnvelope<unknown>(config, 'GET', `/v1/threads/${encodeURIComponent(threadKey)}/steering-receipts?afterId=${encodeURIComponent(afterId)}&limit=200`, undefined, signal)
    const page = SteeringReceiptPage.parse(data)
    items.push(...page.items)
    if (page.nextAfterId === null) return items
    if (page.nextAfterId <= afterId) throw new StagingApiError(200, 'invalid_response', 'Steering receipt cursor did not advance.')
    afterId = page.nextAfterId
  }
}

/** One waiting inbox message: the running item is never listed. */
export interface QueuedMessage {
  id: string
  text: string
  queuedAt: number
}

/** List the waiting messages of a thread (viewer+). */
export function listThreadQueue(config: StagingConfig, threadKey: string): Promise<QueuedMessage[]> {
  return request<QueuedMessage[]>(config, 'GET', `/v1/threads/${encodeURIComponent(threadKey)}/queue`)
}

/** Remove one waiting message (operator+). */
export function removeQueuedMessage(config: StagingConfig, threadKey: string, itemId: string): Promise<{ removed: boolean }> {
  return request(config, 'DELETE', `/v1/threads/${encodeURIComponent(threadKey)}/queue/${encodeURIComponent(itemId)}`, undefined, crypto.randomUUID())
}

/** Reorder the waiting messages; ids must be exactly the current set (operator+). */
export function reorderThreadQueue(config: StagingConfig, threadKey: string, itemIds: string[]): Promise<{ reordered: boolean }> {
  return request(config, 'POST', `/v1/threads/${encodeURIComponent(threadKey)}/queue/reorder`, { itemIds }, crypto.randomUUID())
}

const OperationReceipt = z.object({ operationId: z.string(), toolName: z.string().optional(), state: z.enum(['confirmed', 'unresolved']), reason: z.string(), recordedAt: z.string().optional() })
export type OperationReceipt = z.infer<typeof OperationReceipt>
export const inspectThreadOperation = (config: StagingConfig, thread: string, operationId: string) => requestValidated(config, 'GET', `/v1/threads/${encodeURIComponent(thread)}/operations/${encodeURIComponent(operationId)}`, OperationReceipt)
