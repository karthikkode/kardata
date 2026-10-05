// Plan/task tool activities (B4.2). Hermetic matrix over executeToolCall
// with in-memory deps — no Temporal worker needed: approval block with
// approval event, approve/edit verdicts, timeout finding + recorded
// response, durable replay without re-execution, shapes-only logging. The
// live-DB section proves the pool-backed store records and replays across
// the real event log.
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import {
  storeAndIndex,
  storeArtifact,
} from '../../backend/src/artifacts/pipeline.js'
import {
  appendEvent,
  findEventByKey,
  readPartition,
} from '../../backend/src/db/index.js'
import {
  TOOL_APPROVAL_EVENT,
  TOOL_EXECUTED_EVENT,
  TOOL_TIMEOUT_EVENT,
  executeToolCall,
  type RecordedToolCall,
  type ToolCallDeps,
  type ToolCallInput,
} from '../../backend/src/temporal/activities/tools.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()

function memoryDeps(): ToolCallDeps & { logs: unknown[]; records: unknown[]; recorded?: RecordedToolCall } {
  const logs: unknown[] = []
  const records: unknown[] = []
  const state: { recorded?: RecordedToolCall } = {}
  return {
    logs,
    records,
    get recorded() {
      return state.recorded
    },
    log: (fields) => logs.push(fields),
    findRecorded: async () => state.recorded,
    record: async (event) => {
      records.push(event)
    },
  }
}

function input(overrides: Partial<ToolCallInput> = {}): ToolCallInput {
  return {
    sessionId: 's-tools',
    idempotencyKey: `tools:${STAMP}:${Math.random()}`,
    call: { id: 'call-1', name: 'plan.list', args: {} },
    ...overrides,
  }
}

function types(records: unknown[]): unknown[] {
  return (records as Array<{ type: string }>).map((record) => record.type)
}

describe('tool activities (B4.2) [F:backend.activity.tools.executeToolCall] [F:backend.activity.tools.TOOL_APPROVAL_EVENT] [F:backend.activity.tools.TOOL_EXECUTED_EVENT] [F:backend.activity.tools.TOOL_TIMEOUT_EVENT] [F:backend.activity.tools.DEFAULT_TOOL_TIMEOUT_MS] [F:backend.activity.tools.SENSITIVE_TOOLS] [F:backend.activity.turn.sleep]', () => {
  it('executes a read and records the outcome with snapshots', async () => {
    const d = memoryDeps()
    const outcome = await executeToolCall(input(), d)
    expect(outcome.result).toMatchObject({ toolCallId: 'call-1', toolName: 'plan.list', isError: false })
    expect(outcome.plan.todos).toEqual([])
    expect(types(d.records)).toEqual([TOOL_EXECUTED_EVENT])
    const recorded = d.records[0] as { idempotencyKey: string; payload: Record<string, unknown> }
    expect(recorded.idempotencyKey).toContain('tools:')
    expect(recorded.payload['result']).toMatchObject({ toolName: 'plan.list', isError: false })
    expect(recorded.payload).toHaveProperty('plan')
    expect(recorded.payload).toHaveProperty('tasks')
  })

  it('answers artifact.read as unavailable without archive access', async () => {
    const d = memoryDeps()
    const outcome = await executeToolCall(
      input({ call: { id: 'call-art', name: 'artifact.read', args: { artifactId: 'art-1' } } }),
      d,
    )
    expect(outcome.result).toMatchObject({ toolName: 'artifact.read', isError: true })
    expect(outcome.result.content).toContain('unavailable')
  })

  it('blocks an unapproved sensitive tool with an approval event', async () => {
    const d = memoryDeps()
    const outcome = await executeToolCall(
      input({
        call: { id: 'call sensitive', name: 'plan.create', args: { todos: [] } },
      }),
      d,
    )
    expect(outcome.result.isError).toBe(true)
    expect(outcome.result.content).toMatch(/requires approval/)
    // Never executed: the plan snapshot is still empty.
    expect(outcome.plan.todos).toEqual([])
    expect(types(d.records)).toEqual([TOOL_APPROVAL_EVENT, TOOL_EXECUTED_EVENT])
    const approval = d.records[0] as { payload: Record<string, unknown> }
    expect(approval.payload).toMatchObject({
      approvalId: 'call sensitive',
      toolName: 'plan.create',
      decision: 'denied',
    })
  })

  it('honors reject and edit verdicts', async () => {
    const rejected = memoryDeps()
    const denied = await executeToolCall(
      input({
        call: { id: 'c-r', name: 'plan.create', args: { todos: [] } },
        approval: { verdict: 'reject', reason: 'too broad' },
      }),
      rejected,
    )
    expect(denied.result.isError).toBe(true)
    expect(denied.result.content).toMatch(/rejected by approval gate: too broad/)
    expect(denied.plan.todos).toEqual([])

    const edited = memoryDeps()
    const applied = await executeToolCall(
      input({
        call: { id: 'c-e', name: 'plan.create', args: { todos: [] } },
        approval: {
          verdict: 'edit',
          args: { todos: [{ content: 'Edited scope', status: 'in_progress' }] },
        },
      }),
      edited,
    )
    expect(applied.result.isError).toBe(false)
    expect(applied.result.content).toContain('Edited scope')
    const approval = edited.records[0] as { payload: Record<string, unknown> }
    expect(approval.payload['decision']).toBe('edited')
  })

  it('executes an approved sensitive tool and records the approval', async () => {
    const d = memoryDeps()
    const outcome = await executeToolCall(
      input({
        call: {
          id: 'c-a',
          name: 'plan.create',
          args: { todos: [{ content: 'Ship it', status: 'in_progress' }] },
        },
        approval: { verdict: 'approve' },
      }),
      d,
    )
    expect(outcome.result.isError).toBe(false)
    expect(outcome.plan.todos).toHaveLength(1)
    expect(types(d.records)).toEqual([TOOL_APPROVAL_EVENT, TOOL_EXECUTED_EVENT])
    const approval = d.records[0] as { payload: Record<string, unknown> }
    expect(approval.payload).toMatchObject({ decision: 'approved', toolName: 'plan.create' })
  })

  it('carries plan state across calls through snapshots', async () => {
    const first = memoryDeps()
    const created = await executeToolCall(
      input({
        call: {
          id: 'c-1',
          name: 'plan.create',
          args: { todos: [{ content: 'First', status: 'in_progress' }] },
        },
        approval: { verdict: 'approve' },
      }),
      first,
    )
    const todoId = created.plan.todos[0]?.id
    expect(todoId).toBeDefined()

    // A fresh activity rehydrates from the snapshot: add sees the plan.
    const second = memoryDeps()
    const added = await executeToolCall(
      input({
        call: { id: 'c-2', name: 'plan.add', args: { content: 'Second' } },
        plan: created.plan,
      }),
      second,
    )
    expect(added.result.isError).toBe(false)
    expect(added.plan.todos.map((todo) => todo.content)).toEqual(['First', 'Second'])
    // Ids keep ascending across the rehydration boundary (no todo-1 reuse).
    const ids = added.plan.todos.map((todo) => todo.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('maps a timed-out tool to a finding plus a recorded response', async () => {
    const d = memoryDeps()
    const outcome = await executeToolCall(
      input({
        call: { id: 'c-t', name: 'test.hang', args: {} },
        timeoutMs: 50,
        extraTools: [
          {
            definition: { name: 'test.hang', description: 'Hangs.', parameters: { type: 'object' } },
            handler: () => new Promise(() => undefined),
          },
        ],
      }),
      d,
    )
    // The response: the model sees the timeout, never silence.
    expect(outcome.result.isError).toBe(true)
    expect(outcome.result.content).toMatch(/timed out after 50ms/)
    // The finding plus the recorded response: nothing silent.
    expect(types(d.records)).toEqual([TOOL_TIMEOUT_EVENT, TOOL_EXECUTED_EVENT])
    const finding = d.records[0] as { payload: Record<string, unknown> }
    expect(finding.payload).toMatchObject({ toolCallId: 'c-t', toolName: 'test.hang', timeoutMs: 50 })
    const logged = d.logs[d.logs.length - 1] as Record<string, unknown>
    expect(logged).toMatchObject({ op: 'tool.call', tool: 'test.hang', ok: false, timedOut: true })
  })

  it('replays a recorded outcome without re-executing', async () => {
    const recorded: RecordedToolCall = {
      result: { toolCallId: 'c-p', toolName: 'plan.list', content: 'prior', isError: false },
      plan: { todos: [], nextId: 1 },
      tasks: { checkpoints: [], clarifications: [], blockers: [], submissions: [], failures: [] },
    }
    const logs: unknown[] = []
    const records: unknown[] = []
    const outcome = await executeToolCall(input({ call: { id: 'c-p', name: 'plan.list', args: {} } }), {
      log: (fields) => logs.push(fields),
      findRecorded: async () => recorded,
      record: async (event) => {
        records.push(event)
      },
    })
    expect(outcome).toEqual(recorded)
    expect(records).toHaveLength(0)
    expect(logs).toHaveLength(1)
    expect((logs[0] as Record<string, unknown>)['latencyMs']).toBe(0)
  })

  it('logs shapes only, never args or content', async () => {
    const d = memoryDeps()
    await executeToolCall(
      input({
        call: {
          id: 'c-s',
          name: 'plan.create',
          args: { todos: [{ content: 'SECRET-CONTENT-ZZZ', status: 'in_progress' }] },
        },
        approval: { verdict: 'approve' },
      }),
      d,
    )
    const logged = JSON.stringify(d.logs)
    expect(logged).not.toContain('SECRET-CONTENT-ZZZ')
    expect(JSON.parse(logged) as unknown).toEqual([
      expect.objectContaining({ op: 'tool.call', tool: 'plan.create', ok: true }),
    ])
  })

  describe.skipIf(!ENABLED)('against Postgres', () => {
    it('records and replays across the real event log', async () => {
      const url = await ensureTestDb('kardata_test_tools')
      const pool = new Pool({ connectionString: url })
      try {
        const key = `tools-live:${STAMP}`
        const deps: ToolCallDeps = {
          log: () => undefined,
          findRecorded: async (idempotencyKey) => {
            const row = await findEventByKey(pool, idempotencyKey)
            if (!row || row.type !== TOOL_EXECUTED_EVENT) return undefined
            return (row.payload as { plan: unknown; tasks: unknown; result: unknown }) as unknown as RecordedToolCall
          },
          record: async (event) => {
            await appendEvent(pool, event)
          },
        }
        const first = await executeToolCall(
          {
            sessionId: `s-live-${STAMP}`,
            idempotencyKey: key,
            call: {
              id: 'c-live',
              name: 'task.checkpoint',
              args: { note: 'live checkpoint' },
            },
          },
          deps,
        )
        expect(first.result.isError).toBe(false)
        expect(first.tasks.checkpoints).toHaveLength(1)

        const events = await readPartition(pool, `session:s-live-${STAMP}`)
        expect(events.map((event) => event.type)).toEqual([TOOL_EXECUTED_EVENT])

        // Retry with the same key: identical outcome, zero new events.
        const second = await executeToolCall(
          {
            sessionId: `s-live-${STAMP}`,
            idempotencyKey: key,
            call: {
              id: 'c-live',
              name: 'task.checkpoint',
              args: { note: 'live checkpoint' },
            },
          },
          deps,
        )
        expect(second).toEqual(first)
        expect((await readPartition(pool, `session:s-live-${STAMP}`)).map((event) => event.type)).toEqual([
          TOOL_EXECUTED_EVENT,
        ])
      } finally {
        await pool.end()
      }
    }, 120_000)

    it('reads indexed session files through artifact.read', async () => {
      const url = await ensureTestDb('kardata_test_tools_artifacts')
      const pool = new Pool({ connectionString: url })
      try {
        const target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-tools-art-')))
        const sessionId = `s-art-${STAMP}`
        const archiveDeps = {
          log: () => undefined,
          findEvent: (key: string) => findEventByKey(pool, key),
          record: (event: {
            idempotencyKey: string
            partition: string
            type: string
            payload: Record<string, unknown>
          }) => appendEvent(pool, event).then(() => undefined),
        }
        const indexed = await storeAndIndex(
          target,
          {
            scope: { kind: 'session', id: sessionId },
            name: 'brief.md',
            body: 'tool-visible bytes',
            reason: 'subagent_output',
            producedBy: 'run-tools',
          },
          archiveDeps,
        )
        const raw = await storeArtifact(
          target,
          {
            scope: { kind: 'session', id: sessionId },
            name: 'draft.md',
            body: 'not indexed',
            reason: 'user_upload',
            producedBy: 'test',
          },
          archiveDeps,
        )
        const deps: ToolCallDeps = {
          log: () => undefined,
          findRecorded: async () => undefined,
          record: async (event) => {
            await appendEvent(pool, event)
          },
          artifacts: { db: pool, target },
        }
        const read = async (artifactId: string, key: string) =>
          executeToolCall(
            {
              sessionId,
              idempotencyKey: key,
              call: { id: `c-${key}`, name: 'artifact.read', args: { artifactId } },
            },
            deps,
          )

        const ok = await read(indexed.artifactId, `tools-art-ok:${STAMP}`)
        expect(ok.result).toMatchObject({ toolName: 'artifact.read', isError: false })
        expect(ok.result.content).toBe('tool-visible bytes')

        const missing = await read('art-missing', `tools-art-missing:${STAMP}`)
        expect(missing.result.isError).toBe(true)

        const unindexed = await read(raw.artifactId, `tools-art-raw:${STAMP}`)
        expect(unindexed.result.isError).toBe(true)
        expect(unindexed.result.content).toContain('not indexed')
      } finally {
        await pool.end()
      }
    }, 120_000)
  })
})
