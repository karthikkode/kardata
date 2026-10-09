// Stage 1 live tests (real Meta): L-A3 sector-id line every round,
// L-A1 plan write lock. Spend is diffed per test from the suite database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, recordPlanVersion } from '../../../backend/src/db/index.js'
import { projectNewEvents } from '../../../backend/src/projector.js'
import { LIVE_META_ENABLED, startLiveStack, type LiveStack } from './harness.js'

const SCOPE = { tenantId: 'tenant-live', projectId: null }

function dataOf(body: unknown): Record<string, unknown> {
  return (body as { data: Record<string, unknown> }).data
}

describe.skipIf(!LIVE_META_ENABLED)('live stage 1 (plan lock, sector id) [F:db.index.createSector] [F:db.index.recordPlanVersion] [F:db.sectors.createSector] [F:db.sector_plan.recordPlanVersion] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector]', () => {
  let stack: LiveStack

  beforeAll(async () => {
    stack = await startLiveStack('stage1')
  }, 300_000)

  afterAll(async () => {
    await stack?.close()
  }, 120_000)

  async function agentCount(threadKey: string): Promise<number> {
    return (await stack.messages(threadKey)).filter((m) => m['role'] === 'agent' && typeof m['text'] === 'string' && m['text'].length > 0).length
  }

  async function sendAndWaitReply(threadKey: string, text: string): Promise<void> {
    const before = await agentCount(threadKey)
    const sent = await stack.api('POST', '/v1/commands/send', { threadKey, text })
    expect(sent.status).toBe(202)
    await stack.waitFor(async () => (await agentCount(threadKey)) > before, 480_000, `agent reply in ${threadKey}`)
  }

  it('L-A3: every round request carries the exact sector id line', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live HVAC', topic: 'hvac', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const session = await stack.api('POST', '/v1/sessions', { title: 'Live sector chat', sectorId })
    expect(session.status).toBe(201)
    const sessionId = dataOf(session.body)['id'] as string

    const wordings = [
      'Check the sector, then list its files.',
      'Use your tools: first read this sector details, then list the files in this sector, then summarize both.',
      'Call db.get_sector for this sector, then call db.list_sector_files, then reply with a summary of both results.',
    ]
    let tries = 0
    let requests: Array<{ record: Record<string, unknown> }> = []
    for (const wording of wordings) {
      tries += 1
      await sendAndWaitReply(sessionId, wording)
      requests = await stack.executionRequests(sessionId)
      if (requests.length >= 2) break
    }
    expect(requests.length).toBeGreaterThanOrEqual(2)
    const line = `Current sector: "Live HVAC" (sector id: ${sectorId}). Use exactly this sector id for every sector tool call; never derive an id from the name.`
    for (const entry of requests) {
      const data = entry.record['data'] as Record<string, unknown> | undefined
      expect(String(data?.['systemPrompt'] ?? '')).toContain(line)
    }
    const spendAfter = await stack.spend()
    console.log(`L-A3 tries=${tries} input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)

  it('L-A1: a normal chat cannot change the plan', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live plans', topic: 'plans', scope: SCOPE, initialState: 'planned' })).sectorId
    await projectNewEvents(stack.pool)
    await recordPlanVersion(stack.pool, sectorId, '# Live v1', 'L-A1 seed', SCOPE)
    await projectNewEvents(stack.pool)
    const session = await stack.api('POST', '/v1/sessions', { title: 'Live normal chat', sectorId })
    expect(session.status).toBe(201)
    const sessionId = dataOf(session.body)['id'] as string

    const before = await stack.api('GET', `/v1/sectors/${sectorId}/plan`)
    expect(before.status).toBe(200)
    expect((dataOf(before.body)['versions'] as unknown[]).length).toBe(1)

    await sendAndWaitReply(sessionId, 'Update the research plan to add a search direction for commercial clients.')

    const after = await stack.api('GET', `/v1/sectors/${sectorId}/plan`)
    expect(after.status).toBe(200)
    expect((dataOf(after.body)['versions'] as unknown[]).length).toBe(1)

    const results = await stack.toolResults(sessionId)
    const planCalls = results.filter((entry) => {
      const data = entry.record['data'] as Record<string, unknown> | undefined
      const call = data?.['call'] as Record<string, unknown> | undefined
      return call?.['name'] === 'db.update_sector_plan'
    })
    for (const entry of planCalls) {
      const data = entry.record['data'] as Record<string, unknown> | undefined
      const outcome = data?.['outcome'] as Record<string, unknown> | undefined
      expect(outcome?.['isError']).toBe(true)
    }
    const spendAfter = await stack.spend()
    console.log(`L-A1 planCalls=${planCalls.length} input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)
})
