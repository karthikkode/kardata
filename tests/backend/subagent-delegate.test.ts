// Subagent delegation door: the main agent launches leaf researchers by
// instruction. Hermetic stub-DB tests (no Temporal): validation, session
// ownership, fail-closed without a delegator, role + grant floors, and
// goal/mode passthrough with leaf defaults (depth 0, maxDepth 0 — pilot
// children research, never delegate further).
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import type { TransactableDb } from '../../backend/src/db/index.js'
import { invokeTool, TOOL_META } from '../../backend/src/mcp/tools.js'
import { McpToolError } from '../../backend/src/mcp/tools-types.js'

function stubDb(sessions: Array<{ id: string; sector: string | null }>): TransactableDb {
  return {
    connect: async () => ({}) as unknown as PoolClient,
    async query<TRow>(text: string, params: unknown[] = []): Promise<{ rowCount: number | null; rows: TRow[] }> {
      if (text.includes('WHERE c.id = $1')) {
        const wanted = params[0] as string
        const found = sessions.find((session) => session.id === wanted)
        if (!found) return { rowCount: 0, rows: [] }
        return {
          rowCount: 1,
          rows: [{
            id: found.id, title: 'Pilot chat', sector: found.sector,
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
          }] as unknown as TRow[],
        }
      }
      return { rowCount: 0, rows: [] }
    },
  } as unknown as TransactableDb
}

const SCOPE = { tenantId: 't', projectId: null }

function ctx(db: TransactableDb, role: 'viewer' | 'operator' | 'approver' = 'operator', extra: Record<string, unknown> = {}) {
  return { pool: db, scope: SCOPE, role, keyId: 'key-a', ...extra }
}

function delegatorDouble(seen: Array<Record<string, unknown>>) {
  return {
    async delegateSubagent(input: { sessionId: string; goal: string; mode: string; queueCapacity: number }) {
      seen.push({ ...input })
      return { childId: 'child-abc123', commandId: 'cmd-1' }
    },
  }
}

describe('db.delegate_subagent', () => {
  it('tells parents to write self-contained goals, not global-context pointers', () => {
    const description = TOOL_META['db.delegate_subagent'].description
    expect(description).toContain('self-contained')
    expect(description).toContain('global context')
  })
  it('validates goal and session before any delegation', async () => {
    const db = stubDb([{ id: 's-1', sector: null }])
    const seen: Array<Record<string, unknown>> = []
    const base = ctx(db, 'operator', { delegator: delegatorDouble(seen) })
    await expect(invokeTool('db.delegate_subagent', base, { sessionId: 's-1', goal: '  ' })).rejects.toThrow(
      /non-empty/,
    )
    await expect(invokeTool('db.delegate_subagent', base, { sessionId: '', goal: 'research' })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    await expect(
      invokeTool('db.delegate_subagent', base, { sessionId: 's-1', goal: 'research', mode: 'nope' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(seen).toEqual([])
  })

  it('fails closed without a delegator instead of half-launching', async () => {
    const db = stubDb([{ id: 's-1', sector: null }])
    await expect(invokeTool('db.delegate_subagent', ctx(db), { sessionId: 's-1', goal: 'research' })).rejects.toThrow(
      /no subagent delegator/,
    )
  })

  it('denies viewers and sector-scoped grants (Karbot-only door)', async () => {
    const db = stubDb([{ id: 's-1', sector: null }])
    const seen: Array<Record<string, unknown>> = []
    const delegator = delegatorDouble(seen)
    const denied = await invokeTool(
      'db.delegate_subagent',
      ctx(db, 'viewer', { delegator }),
      {
        sessionId: 's-1',
        goal: 'research',
      },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(denied).toBeInstanceOf(McpToolError)
    expect((denied as McpToolError).code).toBe('permission_denied')
    const grantDenied = await invokeTool(
      'db.delegate_subagent',
      ctx(db, 'operator', { delegator }),
      { sessionId: 's-1', goal: 'research' },
      { allow: new Set(['db.kb_search'] as const) },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(grantDenied).toBeInstanceOf(McpToolError)
    expect((grantDenied as McpToolError).code).toBe('permission_denied')
    expect(seen).toEqual([])
  })

  it('launches with leaf defaults and passes the goal through', async () => {
    const db = stubDb([{ id: 's-1', sector: null }])
    const seen: Array<Record<string, unknown>> = []
    const result = (await invokeTool(
      'db.delegate_subagent',
      ctx(db, 'operator', { delegator: delegatorDouble(seen) }),
      { sessionId: 's-1', goal: 'Research Acme Pay: scale proof, mechanism, cost.' },
    )) as { childId: string; commandId: string }
    expect(result).toMatchObject({ childId: 'child-abc123', commandId: 'cmd-1' })
    expect(seen).toEqual([
      {
        sessionId: 's-1',
        goal: 'Research Acme Pay: scale proof, mechanism, cost.',
        name: 'Subagent 1',
        mode: 'empty',
        queueCapacity: 8,
        // A15 inheritance seam: the parent context write lands between
        // acceptance and the goal signal (order pinned by
        // subagent-inherit.test.ts).
        onAccepted: expect.any(Function),
      },
    ])
  })

  it('404s unknown sessions before any delegation', async () => {
    const db = stubDb([])
    const seen: Array<Record<string, unknown>> = []
    await expect(
      invokeTool(
        'db.delegate_subagent',
        ctx(db, 'operator', { delegator: delegatorDouble(seen) }),
        { sessionId: 's-ghost', goal: 'research' },
      ),
    ).rejects.toThrow(/unknown session/)
    expect(seen).toEqual([])
  })
})
