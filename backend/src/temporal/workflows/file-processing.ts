// Durable file owner. No PDF bytes, provider responses or credentials in history.
import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities/file-processing.js'
import type { FileProcessingInput } from '../activities/file-processing.js'

const work = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes', scheduleToCloseTimeout: '10 minutes',
  heartbeatTimeout: '20 seconds', retry: { maximumAttempts: 3, initialInterval: '2 seconds', maximumInterval: '10 seconds' },
})
const reads = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds', scheduleToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3, initialInterval: '2 seconds' },
})

export async function fileProcessing(input: FileProcessingInput & { cursor?: { page: number; ordinal: number } | null; waits?: number }): Promise<{ state: string }> {
  let cursor = input.cursor ?? null, waits = input.waits ?? 0
  try {
    const prepared = await work.prepareFileProcessingActivity(input)
    if (prepared.state === 'complete') return { state: 'complete' }
    if (!['queued', 'processing'].includes(prepared.state)) return { state: prepared.state }
    let processed = 0
    for (;;) {
      const next = await reads.nextFileImageActivity({ ...input, cursor })
      if (next.state === 'paused') return { state: 'paused' }
      if (!next.imageId) {
        await work.finalizeFileProcessingActivity(input)
        return { state: 'complete' }
      }
      const result = await work.processFileImageActivity({ ...input, imageId: next.imageId })
      if (result.state === 'busy' || result.state === 'overload') {
        // No new provider effect occurred. Bound waiting, preserve the cursor.
        if (++waits >= 120) {
          await reads.failFileProcessingActivity({ ...input, code: 'file_capacity_wait_exhausted' })
          return { state: 'failed' }
        }
        await sleep('5 seconds')
      } else if (result.state === 'complete') {
        cursor = next.nextCursor; waits = 0; processed++
      } else return { state: result.state }
      if (processed >= 50 || waits > 0 && waits % 20 === 0) {
        return await continueAsNew<typeof fileProcessing>({ ...input, cursor, waits })
      }
    }
  } catch (error) {
    // The private activity boundary logged the coded failure and preserves
    // paid receipts. This owner parks without weakening retry authority.
    await reads.failFileProcessingActivity({ ...input, code: 'file_processing_needs_review' })
    throw error
  }
}
