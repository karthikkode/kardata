// Run gateway types: run/command shapes, handle surfaces, workflow
// ids, and the RunsGateway interface. Pure types, no runtime imports
// except the agents FakeStep.
import type { FakeStep } from '@kardata/agents'

export type RunState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'SUSPENDED' | 'CANCELLING' | 'FINISHED' | 'ERROR'

export interface RunInfo {
  id: string
  sessionId: string
  threadKey: string
  state: RunState
  stageCursor?: string
  /** 0 until B5.x wires ledger/telemetry ratios; never a measured value. */
  budgetUsedRatio: number
  contextUsedRatio: number
  updatedAt: string
}

export interface CommandResult {
  commandId: string
  state: 'accepted' | 'missed_steer'
}

/** No such run or thread. Routes answer 404. */
export class RunNotFound extends Error {}

/** Thread exists but cannot take steer right now. Routes answer 409. */
export class ThreadNotAccepting extends Error {}

/** Temporal is unreachable (connectivity, not a domain error). Routes
 * answer 503 so callers retry instead of treating it as a bug. */
export class TemporalUnavailableError extends Error {}

/** Delegation refused before signalling: the durable child queue is full.
 * Extends ThreadNotAccepting so routes answer 409 and tools report
 * conflict, immediately instead of after the 30 s acceptance poll. */
export class ChildQueueFull extends ThreadNotAccepting {}

/** Resolved skill invocation: prompt and tool grant travel with the text
 * so the workflow needs no skill-registry import (workflows never import
 * the agents barrel, which pulls node:http). */
export interface SkillInvocation {
  name: string
  prompt: string
  tools: string[]
  text: string
  mode?: 'default' | 'brainstorm' | 'plan'
}

export interface RunsGateway {
  startFileProcessing?(jobId: string, revision: number): Promise<void>
  listRuns(sessionId?: string): Promise<RunInfo[]>
  getRun(runId: string): Promise<RunInfo | null>
  send(threadKey: string, text: string): Promise<CommandResult>
  sendSkill(threadKey: string, invocation: SkillInvocation): Promise<CommandResult>
  startSectorSweep(sectorId: string, scope?: { tenantId: string; projectId: string | null }): Promise<CommandResult>
  /** Start the sector planning run: one workflow per sector, idempotent
   * by workflow id like sweeps. */
  startSectorPlan(sectorId: string, scope?: { tenantId: string; projectId: string | null }): Promise<CommandResult>
  /** Start one context-file summary: idempotent by workflow id, so a
   * re-approval while summarizing reuses the running workflow. */
  startContextFileSummary(sectorId: string, fileId: string, hash: string): Promise<CommandResult>
  /** Cancel one context-file summary. Best effort: an already-closed
   * run accepts quietly. */
  cancelContextFileSummary(sectorId: string, fileId: string, hash: string): Promise<CommandResult>
  /** Start global-context compaction: one workflow per sector, so a
   * second trigger while one runs is accepted, not duplicated. */
  startContextCompaction(sectorId: string, reason: 'auto' | 'manual'): Promise<CommandResult>
  /** Halt the sector's sweep workflow. An already-closed run accepts
   * quietly (nothing to halt); only an unreachable worker throws. */
  cancelSectorSweep(sectorId: string): Promise<CommandResult>
  /** Launch a leaf subagent researcher under a session's delegation
   * parent (created on first use). Pilot children run at depth 0 with
   * maxDepth 0: they research, never delegate further. */
  delegateSubagent(input: DelegateSubagentInput): Promise<DelegatedChild>
  steer(threadKey: string, text: string): Promise<CommandResult>
  pauseRun(runId: string): Promise<CommandResult>
  resumeRun(runId: string, extendedBudgetMs?: number): Promise<CommandResult>
  cancelRun(runId: string): Promise<CommandResult>
  listQueue(threadKey: string): Promise<Array<{ id: string; text: string; queuedAt: number }>>
  removeQueued(threadKey: string, id: string): Promise<boolean>
  reorderQueue(threadKey: string, ids: string[]): Promise<void>
}

export const SESSION_PREFIX = 'session-run-'

export interface ApprovedCoordinatorHandle {
  workflowId: string
  query(name: 'coordinatorState'): Promise<{ paused: boolean; planVersion?: number }>
  signal(name: 'coordinatorResume'): Promise<void>
  cancel(): Promise<unknown>
  result(): Promise<unknown>
}

export interface DelegateSubagentInput {
  sessionId: string
  goal: string
  /** Owner-given display name; forwarded to the launch event. */
  name?: string
  /** Runs after parent acceptance, before the goal signal: the caller's
   * seam for the spawn-time inherited-context write. */
  onAccepted?: (childId: string) => Promise<void>
  mode: 'empty' | 'fork'
  queueCapacity: number
  /** Test-only scripted fake steps for the child turn. Never set in
   * production (mirrors the workflow fakeSteps precedent). */
  fakeSteps?: FakeStep[]
  /** Test-only task queue override. Production always uses the turn lane;
   * tests point the door at their isolated queue. */
  taskQueue?: string
}

export interface DelegatedChild {
  childId: string
  commandId: string
  /** True when the child waits in the durable queue instead of running. */
  queued: boolean
}

/** Narrow delegation capability for MCP tool contexts: the full gateway
 * satisfies it structurally, fakes implement just this. */
export interface SubagentDelegator {
  delegateSubagent(input: DelegateSubagentInput): Promise<DelegatedChild>
}

/** Minimal handle surface cancelRun needs: signalling a run. */
export interface CancelHandle {
  signal(signal: 'runCancel'): Promise<void>
}

/** Workflow type name of the session-run workflow (workflows/run.ts). The
 * gateway addresses it by string name so client code never bundles
 * workflow code. */
export const SESSION_WORKFLOW_TYPE = 'sessionRun'

export interface SessionSignalStart {
  workflowType: typeof SESSION_WORKFLOW_TYPE
  workflowId: string
  taskQueue: string
  signal: 'runSend' | 'runSteer'
  signalArgs: [string]
  args: [{ sessionId: string }]
}
