// Provider-round recording seam (P3.5). Pure kind/outcome mapping for
// execution_rounds plus the activity-side recorder: refs come from the
// persist stash, appends never throw (a failed round append is a
// warn-logged gap; the execution journal stays the fail-closed store).
import { OperationRecoveryError } from '@kardata/agents'
import { appendProviderRoundEvent, appendToolCallEvent, type ProviderRoundInput, type ToolCallInput } from '../../db/execution-rounds.js'
import type { Db } from '../../db/index.js'

/** execution_rounds kind for a karbot turn: the thread/run/session
 * identity decides, never model output. Compaction rounds ride a
 * `:compaction`-suffixed run id so they never collide with their turn
 * round under the (run, thread, round, attempt) key. */
export function turnKindForRun(threadKey: string, runKey: string, sessionKind: string | undefined): 'chat' | 'research' | 'subagent' | 'plan' {
  if (threadKey.startsWith('agent:')) return 'subagent'
  if (runKey.startsWith('plan:')) return 'plan'
  return sessionKind === 'research' ? 'research' : 'chat'
}

/** execution_rounds outcome for a failed round: cancellation wins, then a
 * timeout-shaped error, else a plain error with its code. */
export function roundOutcomeFor(error: unknown, signal?: AbortSignal): { outcome: 'error' | 'timeout' | 'cancelled'; errorCode: string } {
  if (signal?.aborted) return { outcome: 'cancelled', errorCode: 'turn_cancelled' }
  const text = `${error instanceof Error ? `${error.name} ${error.message}` : String(error)} ${(error as { code?: unknown })?.code ?? ''}`
  if (/timeout/i.test(text)) return { outcome: 'timeout', errorCode: 'provider_timeout' }
  return { outcome: 'error', errorCode: error instanceof OperationRecoveryError ? 'operation_uncertain' : 'provider_failed' }
}

export interface RoundRecorder {
  refs: Map<string, string>
  recordRound(fields: ProviderRoundInput): Promise<void>
  recordToolCall(fields: ToolCallInput): Promise<void>
}

/** Tool-result refs key by provider call id: parallel duplicate calls in
 * one round each keep their own ref. */
export function stashToolRef(refs: Map<string, string>, record: Record<string, unknown>, key: string): void {
  const callId = (record['data'] as { call?: { id?: unknown } } | undefined)?.call?.id
  if (typeof callId === 'string' && callId) refs.set(`tool:${callId}`, key)
}

export function createRoundRecorder(db: Db, partition: string, warn: (event: string, detail: Record<string, unknown>) => void): RoundRecorder {
  const refs = new Map<string, string>()
  return {
    refs,
    recordRound: async (fields) => {
      try {
        const journalKind = fields.turnKind === 'compaction' ? 'compaction' : 'turn'
        const requestRef = refs.get(`${fields.round}:request:${journalKind}`)
        const responseRef = refs.get(`${fields.round}:response:${journalKind}`)
        await appendProviderRoundEvent(db, partition, `provider-round:${fields.runId}:${fields.threadKey}:${fields.round}:${fields.attempt}`, { ...fields, ...(requestRef ? { requestRef } : {}), ...(responseRef ? { responseRef } : {}) })
      } catch (error) {
        warn('karbot.round_record_failed', { code: error instanceof Error ? error.name : 'unknown', round: fields.round })
      }
    },
    recordToolCall: async (fields) => {
      try {
        const resultRef = refs.get(`tool:${fields.callId}`)
        await appendToolCallEvent(db, partition, `tool-call:${fields.runId}:${fields.threadKey}:${fields.round}:${fields.attempt}:${fields.callId}`, { ...fields, ...(resultRef ? { resultRef } : {}) })
      } catch (error) {
        warn('karbot.tool_record_failed', { code: error instanceof Error ? error.name : 'unknown', tool: fields.tool })
      }
    },
  }
}
