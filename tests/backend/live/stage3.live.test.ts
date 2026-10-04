// Stage 3 live tests (real Meta): L-A13 sector reads, L-A14 @chat,
// L-A15 spawn inheritance, L-A16 pause/resume, L-A17 queue edit,
// L-A18 stop, L-PLAN research planning, L-LOCAL local compaction.
// Spend is diffed per test from the suite database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, recordPlanVersion } from '../../../backend/src/db/index.js'
import { projectNewEvents } from '../../../backend/src/projector.js'
import { LIVE_META_ENABLED, startLiveStack, type LiveStack } from './harness.js'

const SCOPE = { tenantId: 'tenant-live', projectId: null }

function dataOf(body: unknown): Record<string, unknown> {
  return (body as { data: Record<string, unknown> }).data
}

async function agentTexts(stack: LiveStack, threadKey: string): Promise<Array<{ seq: number; text: string }>> {
  return (await stack.messages(threadKey))
    .filter((m) => m['role'] === 'agent' && typeof m['text'] === 'string' && (m['text'] as string).length > 0)
    .map((m) => ({ seq: Number(m['seq'] ?? 0), text: m['text'] as string }))
}

async function sendNoWait(stack: LiveStack, threadKey: string, text: string): Promise<void> {
  const sent = await stack.api('POST', '/v1/commands/send', { threadKey, text })
  expect(sent.status).toBe(202)
}

async function sendAndWaitReply(stack: LiveStack, threadKey: string, text: string, timeoutMs = 480_000): Promise<void> {
  const before = (await agentTexts(stack, threadKey)).length
  await sendNoWait(stack, threadKey, text)
  await stack.waitFor(async () => (await agentTexts(stack, threadKey)).length > before, timeoutMs, `agent reply in ${threadKey}`)
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

async function requestToolNames(stack: LiveStack, threadKey: string): Promise<string[][]> {
  return (await stack.executionRequests(threadKey)).map((entry) => {
    const data = entry.record['data'] as Record<string, unknown> | undefined
    const tools = data?.['tools']
    return Array.isArray(tools) ? tools.map((tool) => String((tool as Record<string, unknown>)['name'] ?? '')) : []
  })
}

interface PlanVersion { version: number; markdown?: string; executable?: { acceptance?: string[] } }

async function planVersions(stack: LiveStack, sectorId: string): Promise<PlanVersion[]> {
  const plan = await stack.api('GET', `/v1/sectors/${sectorId}/plan`)
  expect(plan.status).toBe(200)
  return (dataOf(plan.body)['versions'] as PlanVersion[] | undefined) ?? []
}

interface ThreadRow { key: string; status: string }

async function threadsOf(stack: LiveStack, sessionId: string): Promise<ThreadRow[]> {
  const threads = await stack.api('GET', `/v1/sessions/${sessionId}/threads`)
  expect(threads.status).toBe(200)
  return ((threads.body as { data: ThreadRow[] }).data) ?? []
}

async function createChat(stack: LiveStack, sectorId: string, title: string): Promise<string> {
  const session = await stack.api('POST', '/v1/sessions', { title, sectorId })
  expect(session.status).toBe(201)
  return dataOf(session.body)['id'] as string
}

async function seedPlan(stack: LiveStack, sectorId: string, markdown: string): Promise<void> {
  await recordPlanVersion(stack.pool, sectorId, markdown, `live-seed-${Date.now()}`, SCOPE)
  await projectNewEvents(stack.pool)
}

async function waitChildReply(stack: LiveStack, childThreadKey: string, timeoutMs = 480_000): Promise<string> {
  await stack.waitFor(async () => (await agentTexts(stack, childThreadKey)).length > 0, timeoutMs, `child reply in ${childThreadKey}`)
  const texts = await agentTexts(stack, childThreadKey)
  return texts.map((entry) => entry.text).join('\n')
}

function logSpend(label: string, extra: string, before: { inputTokens: number; outputTokens: number }, after: { inputTokens: number; outputTokens: number }): void {
  console.log(`${label} ${extra} input=${after.inputTokens - before.inputTokens} output=${after.outputTokens - before.outputTokens}`)
}

describe.skipIf(!LIVE_META_ENABLED)('live stage 3 (reads, chat refs, subagent control)', () => {
  let stack: LiveStack

  beforeAll(async () => {
    stack = await startLiveStack('stage3')
  }, 300_000)

  afterAll(async () => {
    await stack?.close()
  }, 120_000)

  it('L-A13: a normal chat reads plan, progress, sibling and subagent threads', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live reads', topic: 'reads', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    await seedPlan(stack, sectorId, '# Plan\nTarget mid-size electrical contractors in coastal regions.')

    const siblingId = await createChat(stack, sectorId, 'Sibling brainstorm')
    await sendAndWaitReply(stack, siblingId, 'For the record: our pilot customer is Coastline Electrical. We decided to target mid-size firms first.')
    const spawned = await stack.api('POST', `/v1/sessions/${siblingId}/subagents`, { goal: 'Reply with exactly one sentence describing our pilot customer.', name: 'Pilot reader' })
    expect(spawned.status).toBe(201)
    const childThreadKey = dataOf(spawned.body)['threadKey'] as string
    await waitChildReply(stack, childThreadKey)

    const askId = await createChat(stack, sectorId, 'Ask chat')
    const wordings = [
      'What does the research plan target, what is the research progress, what did the Sibling brainstorm chat decide, and what did its subagent find?',
      'Use your sector tools: read the plan, read the research progress, list the sector chats, then read the Sibling brainstorm chat and its subagent thread, and answer all four parts.',
      `Call db.get_sector_plan, db.get_research_progress, db.read_sector_thread on thread ${siblingId}, and db.read_sector_thread on thread ${childThreadKey}. Then answer: plan target, progress, the sibling decision, the subagent finding.`,
    ]
    let tries = 0
    let calls: ToolCall[] = []
    let reply = ''
    for (const wording of wordings) {
      tries += 1
      await sendAndWaitReply(stack, askId, wording)
      calls = await toolCalls(stack, askId)
      const names = calls.map((call) => call.name)
      const reads = calls.filter((call) => call.name === 'db.read_sector_thread').map((call) => String(call.args['threadKey'] ?? ''))
      reply = (await agentTexts(stack, askId)).map((entry) => entry.text).join('\n')
      if (names.includes('db.get_sector_plan') && names.includes('db.get_research_progress') && reads.includes(siblingId) && reads.includes(childThreadKey) && reply.includes('Coastline Electrical')) break
    }
    const names = calls.map((call) => call.name)
    expect(names).toContain('db.get_sector_plan')
    expect(names).toContain('db.get_research_progress')
    const reads = calls.filter((call) => call.name === 'db.read_sector_thread').map((call) => String(call.args['threadKey'] ?? ''))
    expect(reads).toContain(siblingId)
    expect(reads).toContain(childThreadKey)
    expect(reply).toContain('Coastline Electrical')
    logSpend('L-A13', `tries=${tries}`, spendBefore, await stack.spend())
  }, 600_000)

  it('L-A14: @chat advises without touching the plan, then updates after confirm', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live refs', topic: 'refs', scope: SCOPE, initialState: 'planned' })).sectorId
    await projectNewEvents(stack.pool)
    await seedPlan(stack, sectorId, '# Plan\nTarget residential contractors first.')
    const researchId = dataOf((await stack.api('POST', `/v1/sectors/${sectorId}/research-session`, {})).body)['id'] as string
    const siblingId = await createChat(stack, sectorId, 'Commercial notes')
    await sendAndWaitReply(stack, siblingId, 'Commercial customers buy bigger jobs than residential ones. We should weigh commercial work equally.')

    await sendAndWaitReply(stack, researchId, `[[session:${siblingId}|Commercial notes]] Given that chat, what should change in the plan?`)
    const turn1Calls = await toolCalls(stack, researchId)
    const turn1Reads = turn1Calls.filter((call) => call.name === 'db.read_sector_thread').map((call) => String(call.args['threadKey'] ?? ''))
    expect(turn1Reads).toContain(siblingId)
    expect((await planVersions(stack, sectorId)).length).toBe(1)
    const turn1Tools = await requestToolNames(stack, researchId)
    expect(turn1Tools.length).toBeGreaterThan(0)
    for (const tools of turn1Tools) expect(tools).not.toContain('db.update_sector_plan')

    const updates = [
      'Yes, update the plan accordingly.',
      'Yes. Call db.update_sector_plan now to add the commercial search direction we discussed.',
    ]
    let tries = 0
    for (const wording of updates) {
      tries += 1
      await sendAndWaitReply(stack, researchId, wording)
      if ((await planVersions(stack, sectorId)).length >= 2) break
    }
    expect((await planVersions(stack, sectorId)).length).toBeGreaterThanOrEqual(2)
    logSpend('L-A14', `tries=${tries}`, spendBefore, await stack.spend())
  }, 600_000)

  it('L-A15: spawned children inherit the parent context', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live inherit', topic: 'inherit', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const parentId = await createChat(stack, sectorId, 'Parent chat')
    await sendAndWaitReply(stack, parentId, 'Our code word is HARBOUR-42. Remember it for this sector.')

    const spawned = await stack.api('POST', `/v1/sessions/${parentId}/subagents`, { goal: 'What is our code word? Reply with it and nothing else.', name: 'Code check' })
    expect(spawned.status).toBe(201)
    const childThreadKey = dataOf(spawned.body)['threadKey'] as string
    const ownerReply = await waitChildReply(stack, childThreadKey)
    expect(ownerReply).toContain('HARBOUR-42')
    const inherited = await stack.pool.query<{ inherited: string }>('SELECT inherited FROM thread_context WHERE thread_key=$1', [childThreadKey])
    expect(inherited.rows[0]?.inherited ?? '').toContain('HARBOUR-42')

    const threadsBefore = (await threadsOf(stack, parentId)).map((thread) => thread.key)
    const wordings = [
      'Spawn a subagent to tell me our code word.',
      'Spawn a subagent whose goal is to reply with our code word.',
      'Call db.delegate_subagent now with the goal: reply with our code word.',
    ]
    let tries = 0
    let childKey = ''
    for (const wording of wordings) {
      tries += 1
      await sendAndWaitReply(stack, parentId, wording)
      const fresh = (await threadsOf(stack, parentId)).map((thread) => thread.key).filter((key) => !threadsBefore.includes(key) && key.startsWith('agent:'))
      if (fresh.length > 0) {
        childKey = fresh[0] ?? ''
        break
      }
    }
    expect(childKey).not.toBe('')
    const parentSpawnedReply = await waitChildReply(stack, childKey)
    expect(parentSpawnedReply).toContain('HARBOUR-42')
    logSpend('L-A15', `tries=${tries}`, spendBefore, await stack.spend())
  }, 600_000)

  it('L-A16: a paused subagent freezes while its sibling keeps working', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live pause', topic: 'pause', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const parentId = await createChat(stack, sectorId, 'Pause parent')
    const goal = 'Write a detailed five-paragraph analysis of pilot customer acquisition for contractors like ours, then a sixth paragraph listing the three biggest risks.'
    const first = dataOf((await stack.api('POST', `/v1/sessions/${parentId}/subagents`, { goal, name: 'Paused one' })).body)
    const second = dataOf((await stack.api('POST', `/v1/sessions/${parentId}/subagents`, { goal, name: 'Running one' })).body)
    const pausedThread = first['threadKey'] as string
    const pausedChild = first['childId'] as string
    const runningThread = second['threadKey'] as string
    await stack.waitFor(async () => (await stack.executionRequests(pausedThread)).length >= 1, 240_000, 'paused child mid-run')

    const paused = await stack.api('POST', '/v1/commands/pause', { runId: pausedChild })
    expect(paused.status).toBe(202)
    await stack.waitFor(async () => (await threadsOf(stack, parentId)).some((thread) => thread.key === pausedThread && thread.status === 'PAUSED'), 120_000, 'paused status')
    const frozenAt = (await stack.executionRequests(pausedThread)).length
    const siblingBefore = (await stack.executionRequests(runningThread)).length
    await new Promise((resolve) => setTimeout(resolve, 60_000))
    expect((await stack.executionRequests(pausedThread)).length).toBe(frozenAt)
    const siblingAfter = (await stack.executionRequests(runningThread)).length
    const siblingReplied = (await agentTexts(stack, runningThread)).length > 0
    expect(siblingAfter > siblingBefore || siblingReplied).toBe(true)

    const resumed = await stack.api('POST', '/v1/commands/resume', { runId: pausedChild })
    expect(resumed.status).toBe(202)
    const finished = await waitChildReply(stack, pausedThread)
    expect(finished.length).toBeGreaterThan(0)
    logSpend('L-A16', 'tries=1', spendBefore, await stack.spend())
  }, 600_000)

  it('L-A17: queued messages list, shrink and reorder before they run', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live queue', topic: 'queue', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const chatId = await createChat(stack, sectorId, 'Queue chat')
    await sendNoWait(stack, chatId, 'Write a detailed ten-paragraph guide to pricing service contracts for electrical contractors, one paragraph per pricing model.')
    await stack.waitFor(async () => (await stack.executionRequests(chatId)).length >= 1, 240_000, 'busy chat turn')
    await sendNoWait(stack, chatId, 'Reply only with ONE')
    await sendNoWait(stack, chatId, 'Reply only with TWO')
    await sendNoWait(stack, chatId, 'Reply only with THREE')
    interface QueueItem { id: string; text: string; queuedAt: number }
    const listQueue = async (): Promise<QueueItem[]> => {
      const listed = await stack.api('GET', `/v1/threads/${chatId}/queue`)
      expect(listed.status).toBe(200)
      return (listed.body as { data: QueueItem[] }).data
    }
    await stack.waitFor(async () => (await listQueue()).length === 3, 60_000, 'three queued')
    const items = await listQueue()
    expect(items.map((item) => item.text)).toEqual(['Reply only with ONE', 'Reply only with TWO', 'Reply only with THREE'])
    for (const item of items) {
      expect(typeof item.id).toBe('string')
      expect(item.id.length).toBeGreaterThan(0)
    }
    const two = items[1]?.id ?? ''
    const three = items[2]?.id ?? ''
    const one = items[0]?.id ?? ''
    const removed = await stack.api('DELETE', `/v1/threads/${chatId}/queue/${two}`)
    expect(removed.status).toBe(200)
    const reordered = await stack.api('POST', `/v1/threads/${chatId}/queue/reorder`, { itemIds: [three, one] })
    expect(reordered.status).toBe(200)
    expect((await listQueue()).map((item) => item.text)).toEqual(['Reply only with THREE', 'Reply only with ONE'])

    const shortReplies = async (): Promise<Array<{ seq: number; word: string }>> => {
      const out: Array<{ seq: number; word: string }> = []
      for (const entry of await agentTexts(stack, chatId)) {
        const text = entry.text.trim()
        const word = text.toUpperCase().match(/\b(ONE|TWO|THREE)\b/)?.[1]
        if (word && text.length <= 30) out.push({ seq: entry.seq, word })
      }
      return out.sort((a, b) => a.seq - b.seq)
    }
    await stack.waitFor(async () => (await shortReplies()).length >= 2, 480_000, 'queued replies drain')
    const words = (await shortReplies()).map((entry) => entry.word)
    expect(words).toEqual(['THREE', 'ONE'])
    logSpend('L-A17', 'tries=1', spendBefore, await stack.spend())
  }, 600_000)

  it('L-A18: a stopped chat and a stopped subagent go quiet', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live stop', topic: 'stop', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const chatId = await createChat(stack, sectorId, 'Stop chat')
    await sendNoWait(stack, chatId, 'Write a detailed ten-paragraph guide to pricing service contracts for electrical contractors, one paragraph per pricing model.')
    await stack.waitFor(async () => (await stack.executionRequests(chatId)).length >= 1, 240_000, 'chat mid-run')
    const stopped = await stack.api('POST', '/v1/commands/cancel', { runId: `session-run-${chatId}` })
    expect(stopped.status).toBe(202)
    const chatFrozenAt = (await stack.executionRequests(chatId)).length
    await stack.waitFor(async () => (await stack.messages(chatId)).some((m) => m['text'] === 'run cancelled'), 120_000, 'cancelled marker')
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    expect((await stack.executionRequests(chatId)).length).toBe(chatFrozenAt)

    const parentId = await createChat(stack, sectorId, 'Stop parent')
    const child = dataOf((await stack.api('POST', `/v1/sessions/${parentId}/subagents`, { goal: 'Write a detailed ten-paragraph guide to pricing service contracts, one paragraph per pricing model.', name: 'Stopped one' })).body)
    const childId = child['childId'] as string
    const childThread = child['threadKey'] as string
    await stack.waitFor(async () => (await stack.executionRequests(childThread)).length >= 1, 240_000, 'child mid-run')
    const childStopped = await stack.api('POST', '/v1/commands/cancel', { runId: childId })
    expect(childStopped.status).toBe(202)
    const childFrozenAt = (await stack.executionRequests(childThread)).length
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    expect((await stack.executionRequests(childThread)).length).toBe(childFrozenAt)
    const completions = await stack.pool.query<{ payload: unknown }>(`SELECT payload FROM events WHERE type='t.subagent.completed'`)
    const mine = completions.rows.map((row) => ((row.payload as Record<string, unknown>)['summary'] as Record<string, unknown> | undefined)).find((summary) => summary?.['id'] === childId)
    expect(mine?.['status']).toBe('cancelled')
    logSpend('L-A18', 'tries=1', spendBefore, await stack.spend())
  }, 600_000)

  it('L-PLAN: the research flow produces an executable plan the owner approves', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live plan', topic: 'electrical contractors', scope: SCOPE, initialState: 'draft' })).sectorId
    await projectNewEvents(stack.pool)
    const patched = await stack.api('PATCH', `/v1/sectors/${sectorId}/global-context`, {
      baseVersion: 0,
      sections: {
        scope: 'Find electrical contractors on the coast who need service-contract help.',
        instructions: '',
        decisions: 'Target mid-size firms first.',
        findings: 'Coastal firms buy bigger jobs.',
        questions: 'Which firms are hiring?',
      },
    })
    expect(patched.status).toBe(200)
    const planned = await stack.api('POST', `/v1/sectors/${sectorId}/plan`, {})
    expect(planned.status).toBe(200)
    await stack.waitFor(async () => {
      const versions = await planVersions(stack, sectorId)
      const latest = versions.at(-1)
      return versions.length >= 1 && (latest?.executable?.acceptance?.length ?? 0) >= 1
    }, 600_000, 'executable plan with acceptance criteria')

    const researchId = dataOf((await stack.api('POST', `/v1/sectors/${sectorId}/research-session`, {})).body)['id'] as string
    const wordings = [
      'Draft the detailed research plan with acceptance criteria for this sector.',
      'Write the full research plan now: discovery directions, budgets, and acceptance criteria.',
      'Call db.update_sector_plan now with the detailed plan including acceptance criteria.',
    ]
    const apiVersions = (await planVersions(stack, sectorId)).length
    let tries = 0
    for (const wording of wordings) {
      tries += 1
      await sendAndWaitReply(stack, researchId, wording)
      if ((await planVersions(stack, sectorId)).length > apiVersions) break
    }
    const versions = await planVersions(stack, sectorId)
    expect(versions.length).toBeGreaterThan(apiVersions)
    const approved = await stack.api('POST', `/v1/sectors/${sectorId}/approve`, { version: versions.at(-1)?.version ?? 1 })
    expect(approved.status).toBe(200)
    expect(Number(dataOf(approved.body)['approvedVersion'] ?? 0)).toBe(versions.at(-1)?.version ?? 1)
    logSpend('L-PLAN', `tries=${tries}`, spendBefore, await stack.spend())
  }, 600_000)

  it('L-LOCAL: local usage auto-compacts at 80% and the manual button works', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live local', topic: 'local', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const chatId = await createChat(stack, sectorId, 'Long chat')
    const localOf = async (threadKey: string): Promise<{ coveredSeq: number; summary: string; inputTokens: number }> => {
      const local = await stack.api('GET', `/v1/threads/${threadKey}/context`)
      expect(local.status).toBe(200)
      const data = dataOf(local.body)
      const usage = (data['usage'] as Record<string, unknown> | undefined) ?? {}
      return { coveredSeq: Number(data['coveredSeq'] ?? 0), summary: String(data['summary'] ?? ''), inputTokens: Number(usage['inputTokens'] ?? 0) }
    }
    // ~30k estimated tokens per part: the history crosses 80% of the
    // 100k budget over several turns while every message stays small
    // enough to compact. One giant part trips the deliberate short-history
    // refusal (fewer than 4 messages) and parks the turn instead.
    const paragraph = 'Electrical contractors price service contracts by site visits, response tiers, and parts margins. '
    const blob = paragraph.repeat(1100)
    for (let round = 0; round < 4; round += 1) {
      await sendAndWaitReply(stack, chatId, `Pasted notes part ${round + 1} (acknowledge briefly, do not summarize):\n\n${blob}`)
      if ((await localOf(chatId)).coveredSeq > 0) break
    }
    const auto = await localOf(chatId)
    expect(auto.coveredSeq).toBeGreaterThan(0)
    expect(auto.summary.length).toBeGreaterThan(0)

    const otherId = await createChat(stack, sectorId, 'Compact chat')
    await sendAndWaitReply(stack, otherId, 'Remember this: the pilot vertical is electrical contractors.')
    await sendAndWaitReply(stack, otherId, 'Remember this too: coastal firms buy bigger jobs.')
    const manual = await stack.api('POST', `/v1/threads/${otherId}/context/compact`, {})
    expect(manual.status).toBe(200)
    const after = await localOf(otherId)
    expect(after.coveredSeq).toBeGreaterThan(0)
    logSpend('L-LOCAL', 'tries=1', spendBefore, await stack.spend())
  }, 600_000)
})
