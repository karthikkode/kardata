// MCP tool shared types: the tool context, tool errors, and the
// skill-scoped grant. Imported by both the dispatcher (tools.ts) and
// the handler table (tool-invokers.ts).
import type { Logger } from 'pino'
import type { Role, Scope } from '../auth/types.js'
import { DbContractError, type SectorSweepRunner, type ThreadMessenger, type TransactableDb } from '../db/index.js'
import { type SubagentDelegator } from '../temporal/runs-types.js'
import type { ArchiveTarget } from '../archive/targets.js'
import { type FileProcessorRunner } from '../file-ingestion.js'
import { type McpToolName } from './schemas.js'

export interface McpToolContext {
  /** Trusted file-processing capability; PDF attachment fails before effects
   * when absent. Model arguments cannot install a runner or choose authority. */
  fileProcessor?: FileProcessorRunner
  runReader?: { getRun(runId: string): Promise<{ sessionId: string; threadKey: string } | null> }
  executionThread?: string
  pool: TransactableDb
  scope: Scope | undefined
  role: Role
  /** Caller key id: idempotency keys are namespaced per caller, matching
   * the HTTP withIdempotency `${keyId}:${key}` convention. */
  keyId: string
  /** Sweep runner for research-start tools. Absent (tests, minimal embeds):
   * start tools fail closed instead of half-starting a sector. */
  runs?: SectorSweepRunner
  /** Subagent delegator for the delegation door. Absent: delegate calls
   * fail closed instead of half-launching a child. */
  delegator?: SubagentDelegator
  /** Thread messenger (runs gateway) for Karbot steering tools. Absent
   * outside the server: send/steer fail closed instead of half-signaling. */
  messenger?: ThreadMessenger
  /** Archive target for file body storage. Absent: the layer resolves its
   * default (filesystem dev target, GCS when configured). */
  archive?: ArchiveTarget
  /** Optional join-key logger. When present every tool execution emits the
   * start/done/error triple (op tool.call, tool name, latencyMs, outcome)
   * so cross-module calls always leave evidence. Absent in unit tests. */
  logger?: Logger
}

/** Tool-level failure: answered as an MCP isError result, never thrown. */
export class McpToolError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Only explicit pre-dispatch failures may release a mutation replay guard. */
export class McpPreconditionError extends DbContractError {
  readonly wireCode = 'unconfigured'
}

/** Skill-scoped grant: when present, only the listed tools may run. Skill
 * invocation passes its declared tool set so one skill can never reach
 * another skill's (or sensitive plumbing) tools. */
export interface ToolGrant {
  allow?: ReadonlySet<McpToolName>
}
