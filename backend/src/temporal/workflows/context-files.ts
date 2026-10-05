// One standardized summary block per context file. History holds IDs only.
import { proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/context-files.js'
import type { ContextCompactionInput, ContextFileSummaryInput } from '../activities/context-files.js'

const summarize = proxyActivities<typeof activities>({ startToCloseTimeout: '10 minutes', retry: { maximumAttempts: 3 } })

export async function contextFileSummary(input: ContextFileSummaryInput): Promise<{ applied: boolean }> {
  return summarize.summarizeContextFileActivity(input)
}

export async function globalContextCompaction(input: ContextCompactionInput): Promise<{ compacted: boolean; version?: number }> {
  return summarize.compactGlobalContextActivity(input)
}
