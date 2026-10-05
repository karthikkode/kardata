// One standardized summary block per context file. History holds IDs only.
import { log, proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/context-files.js'
import type { ContextCompactionInput, ContextFileSummaryInput } from '../activities/context-files.js'

const summarize = proxyActivities<typeof activities>({ startToCloseTimeout: '10 minutes', retry: { maximumAttempts: 3 } })

export async function contextFileSummary(input: ContextFileSummaryInput): Promise<{ applied: boolean }> {
  log.info('workflow.context_file_summary.start', { fileId: input.fileId })
  try {
    const result = await summarize.summarizeContextFileActivity(input)
    log.info('workflow.context_file_summary.done', { fileId: input.fileId, applied: result.applied })
    return result
  } catch (error) {
    log.error('workflow.context_file_summary.error', { fileId: input.fileId, code: error instanceof Error ? error.name : 'unknown' })
    throw error
  }
}

export async function globalContextCompaction(input: ContextCompactionInput): Promise<{ compacted: boolean; version?: number }> {
  log.info('workflow.global_context_compaction.start', { sectorId: input.sectorId })
  try {
    const result = await summarize.compactGlobalContextActivity(input)
    log.info('workflow.global_context_compaction.done', { sectorId: input.sectorId, compacted: result.compacted })
    return result
  } catch (error) {
    log.error('workflow.global_context_compaction.error', { sectorId: input.sectorId, code: error instanceof Error ? error.name : 'unknown' })
    throw error
  }
}
