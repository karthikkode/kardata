// Command API: approvals, thread send/steer, run pause/resume/cancel.
import { request, type StagingConfig } from './client'

export function decideApproval(
  config: StagingConfig,
  approvalId: string,
  decision: 'approved' | 'denied',
): Promise<{ commandId: string }> {
  return request(config, 'POST', '/v1/commands/approve', { approvalId, decision })
}

/** Accepted command outcome. `missed_steer` means the text landed after the
 * run moved on: shown, never silently relaunched (backend commands.ts). */
export interface CommandAccepted {
  commandId: string
  state: 'accepted' | 'missed_steer'
}

/** Talk to a thread's run (operator+). The reply arrives through the
 * thread stream/message list, never in this response. */
export function sendThreadText(
  config: StagingConfig,
  threadKey: string,
  text: string,
): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/send', { threadKey, text })
}

export function steerThread(
  config: StagingConfig,
  threadKey: string,
  text: string,
): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/steer', { threadKey, text })
}

export function cancelRun(config: StagingConfig, runId: string): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/cancel', { runId })
}
export function resumeRun(config: StagingConfig, runId: string): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/resume', { runId })
}
export function pauseRun(config: StagingConfig, runId: string): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/pause', { runId })
}
