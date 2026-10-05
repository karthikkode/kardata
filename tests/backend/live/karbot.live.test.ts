// Karbot live tests (real Meta): L-K1 status answers, L-K2 research
// steering, L-K3 monitor ticks. Spend is diffed per test.
// Requires KARDATA_LIVE_META=1 (via LIVE_META_ENABLED) plus TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, createSector, createSession, ensureResearchSession, markCompanyFound, recordPlanVersion } from '../../../backend/src/db/index.js'
import { projectNewEvents } from '../../../backend/src/projector.js'
import { LIVE_META_ENABLED, LIVE_PORT, startLiveStack, type LiveStack } from './harness.js'

const SCOPE = { tenantId: 'tenant-live', projectId: null }

function dataOf(body: unknown): Record<string, unknown> {
  return (body as { data: Record<string, unknown> }).data
}

interface ToolCall { name: string; args: Record<string, unknown>; isError: boolean }

async function toolCalls(stack: LiveStack, threadKey: string): Promise<ToolCall[]> {
  return (await stack.toolResults(threadKey)).map((entry) => {
    const data = entry.record['data'] as Record<string, unknown> | undefined
    const call = data?.['call'] as Record<string, unknown> | undefined
    const outcome = data?.['outcome'] as Record<string, unknown> | undefined
    return { name: String(call?.['name'] ?? ''), args: (call?.['args'] as Record<string, unknown> | undefined) ?? {}, isError: outcome?.['isError'] === true }
  })
}

async function agentTexts(stack: LiveStack, threadKey: string): Promise<string[]> {
  return (await stack.messages(threadKey))
    .filter((m) => m['role'] === 'agent' && typeof m['text'] === 'string' && m['text'].length > 0)
    .map((m) => m['text'] as string)
}

describe.skipIf(!LIVE_META_ENABLED)('live Karbot (status, steer, monitor) [F:mcp.db.get_research_progress] [F:mcp.db.read_sector_thread] [F:mcp.db.steer_thread] [F:mcp.ops.start_monitor] [F:mcp.db.mark_company_found] [F:backend.workflow.monitor.karbotMonitor] [F:backend.activity.monitor.monitorTickActivity] [F:db.index.createSector] [F:db.index.markCompanyFound] [F:db.sectors.createSector] [F:db.workspace.ensureResearchSession] [F:db.sector_plan.recordPlanVersion]', () => {
  let stack: LiveStack

  beforeAll(async () => {
    stack = await startLiveStack('karbot')
  }, 300_000)

  afterAll(async () => {
    await stack?.close()
  }, 120_000)

  async function karbotChat(): Promise<string> {
    const session = await stack.api('POST', '/v1/sessions', { title: 'Live Karbot chat' })
    expect(session.status).toBe(201)
    return dataOf(session.body)['id'] as string
  }

  async function sendAndWaitReply(threadKey: string, text: string, timeoutMs = 480_000): Promise<void> {
    const before = (await agentTexts(stack, threadKey)).length
    const sent = await stack.api('POST', '/v1/commands/send', { threadKey, text })
    expect(sent.status).toBe(202)
    await stack.waitFor(async () => (await agentTexts(stack, threadKey)).length > before, timeoutMs, `agent reply in ${threadKey}`)
  }

  it('L-K1: Karbot reports research status and subagent findings from tools', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live Research K1', topic: 'k1', scope: SCOPE })).sectorId
    await recordPlanVersion(stack.pool, sectorId, '# Live K1', 'Target Sydney sparkies first.', SCOPE)
    await markCompanyFound(stack.pool, { sectorId, name: 'Acme Live Widgets', scope: SCOPE })
    await markCompanyFound(stack.pool, { sectorId, name: 'Beta Live Plumbing', scope: SCOPE })
    const chat = (await createSession(stack.pool, 'Live K1 chat', SCOPE, sectorId)).id
    await appendEvent(stack.pool, { idempotencyKey: `lk1-launch-${sectorId}`, partition: `session:${chat}`, type: 't.subagent.launched', payload: { sessionId: chat, parentSessionId: chat, childId: 'child-lk1', name: 'Live K1 child', canDelegate: false } })
    await appendEvent(stack.pool, { idempotencyKey: `lk1-msg-${sectorId}`, partition: `child:child-lk1`, type: 't.message.appended', payload: { threadKey: 'agent:child-lk1', kind: 'text', message: { role: 'agent', text: 'Found Acme Live Widgets: licensed, bonded, insured. Verdict: qualified.' } } })
    await projectNewEvents(stack.pool)
    const karbot = await karbotChat()

    const wordings = [
      'How is the research in sector "Live Research K1" doing, and what did its subagent find?',
      `Use your sector tools with sectorId "${sectorId}": read the research progress and the subagent transcript for "Live Research K1", then summarize both with names.`,
      `Call db.get_research_progress and db.read_sector_thread for sector "${sectorId}" and summarize both results with company names.`,
    ]
    let tries = 0
    let ok = false
    for (const wording of wordings) {
      tries += 1
      await sendAndWaitReply(karbot, wording)
      const replies = await agentTexts(stack, karbot)
      const calls = (await toolCalls(stack, karbot)).map((call) => call.name)
      const usedProgress = calls.includes('db.get_research_progress') || calls.includes('db.get_sector_plan')
      const usedTranscript = calls.includes('db.read_sector_thread') || calls.includes('db.get_thread')
      const last = replies.at(-1) ?? ''
      if (usedProgress && usedTranscript && last.includes('Acme Live Widgets')) { ok = true; break }
    }
    expect(ok).toBe(true)
    const spendAfter = await stack.spend()
    console.log(`L-K1 tries=${tries} input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)

  it('L-K2: Karbot steers the research parent on command', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live Research K2', topic: 'k2', scope: SCOPE })).sectorId
    const research = (await ensureResearchSession(stack.pool, sectorId, SCOPE)).id
    await projectNewEvents(stack.pool)
    const karbot = await karbotChat()

    const wordings = [
      'Steer the research in sector "Live Research K2" to skip franchises.',
      'I confirm: steer the "Live Research K2" research conversation now to skip franchises. Do it, do not ask.',
      `Call db.steer_thread on the "Live Research K2" research thread with "skip franchises". I confirm this steering.`,
    ]
    let tries = 0
    let ok = false
    for (const wording of wordings) {
      tries += 1
      await sendAndWaitReply(karbot, wording)
      const calls = await toolCalls(stack, karbot)
      const steered = calls.some((call) => call.name === 'db.steer_thread' && !call.isError)
      const { rows } = await stack.pool.query<{ text: string }>('SELECT text FROM thread_instructions WHERE thread_key = $1', [research])
      if (steered && rows.some((row) => row.text.toLowerCase().includes('franchis'))) { ok = true; break }
    }
    expect(ok).toBe(true)
    const spendAfter = await stack.spend()
    console.log(`L-K2 tries=${tries} input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)

  it('L-K3: a 5-minute monitor ticks and reports seeded duplicates', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live Research K3', topic: 'k3', scope: SCOPE })).sectorId
    const research = (await ensureResearchSession(stack.pool, sectorId, SCOPE)).id
    await projectNewEvents(stack.pool)
    const karbot = await karbotChat()
    await sendAndWaitReply(karbot, `Monitor the research in sector "Live Research K3" (id ${sectorId}) every 5 minutes: check quality and progress, steer if quality drops.`)
    const calls = await toolCalls(stack, karbot)
    expect(calls.some((call) => call.name === 'ops.start_monitor' && !call.isError)).toBe(true)
    const monitors = await stack.pool.query<{ id: string }>('SELECT id FROM monitors WHERE target_sector_id = $1 AND stopped_at IS NULL', [sectorId])
    expect(monitors.rows).toHaveLength(1)

    for (let n = 0; n < 5; n++) {
      const response = await fetch(`http://127.0.0.1:${LIVE_PORT}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.ownerKey}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: n + 1, method: 'tools/call', params: { name: 'db.mark_company_found', arguments: { sectorId, name: 'Duplicate Live Co', companyId: `live-dupe-${n}` } } }),
      })
      expect(response.status).toBe(200)
    }
    await projectNewEvents(stack.pool)

    const reportedOrSteered = async (): Promise<boolean> => {
      const ticks = (await stack.messages(karbot)).filter((m) => m['role'] === 'user' && typeof m['text'] === 'string' && m['text'].startsWith('[Monitor')).length
      if (ticks < 3) return false
      const replies = (await agentTexts(stack, karbot)).join('\n').toLowerCase()
      if (replies.includes('duplicat')) return true
      const { rows } = await stack.pool.query<{ text: string }>('SELECT text FROM thread_instructions WHERE thread_key = $1', [research])
      return rows.length > 0
    }
    await stack.waitFor(reportedOrSteered, 1_500_000, '3 ticks with a duplicate report or steer')
    expect(await reportedOrSteered()).toBe(true)
    const spendAfter = await stack.spend()
    console.log(`L-K3 tries=1 input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 1_800_000)
})
