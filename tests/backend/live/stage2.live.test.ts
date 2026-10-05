// Stage 2 live tests (real Meta): L-A4/A5 sections plus per-chat switch,
// L-A6 file blocks. Spend is diffed per test from the suite database.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, readGlobalContextUsage } from '../../../backend/src/db/index.js'
import { extractNumberTokens, findMissingNumbers, validateBlockTemplate } from '../../../backend/src/db/context-files.js'
import { projectNewEvents } from '../../../backend/src/projector.js'
import { LIVE_META_ENABLED, startLiveStack, type LiveStack } from './harness.js'

const SCOPE = { tenantId: 'tenant-live', projectId: null }
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function dataOf(body: unknown): Record<string, unknown> {
  return (body as { data: Record<string, unknown> }).data
}

async function agentCount(stack: LiveStack, threadKey: string): Promise<number> {
  return (await stack.messages(threadKey)).filter((m) => m['role'] === 'agent' && typeof m['text'] === 'string' && m['text'].length > 0).length
}

async function sendAndWaitReply(stack: LiveStack, threadKey: string, text: string): Promise<void> {
  const before = await agentCount(stack, threadKey)
  const sent = await stack.api('POST', '/v1/commands/send', { threadKey, text })
  expect(sent.status).toBe(202)
  await stack.waitFor(async () => (await agentCount(stack, threadKey)) > before, 480_000, `agent reply in ${threadKey}`)
}

async function latestSystemPrompt(stack: LiveStack, threadKey: string): Promise<string> {
  const requests = await stack.executionRequests(threadKey)
  expect(requests.length).toBeGreaterThan(0)
  const data = requests.at(-1)?.record['data'] as Record<string, unknown> | undefined
  return String(data?.['systemPrompt'] ?? '')
}

async function upload(stack: LiveStack, sectorId: string, filename: string): Promise<string> {
  const contentBase64 = readFileSync(join(FIXTURES, filename)).toString('base64')
  const response = await stack.api('POST', `/v1/sectors/${sectorId}/documents`, { filename, contentBase64 })
  expect(response.status).toBe(201)
  return dataOf(response.body)['id'] as string
}

async function addAndWaitReady(stack: LiveStack, sectorId: string, fileId: string): Promise<void> {
  await stack.waitFor(async () => {
    const library = await stack.api('GET', `/v1/sectors/${sectorId}/files`)
    const files = (library.body as { data: Array<{ id: string; status: string }> }).data
    return files.some((file) => file.id === fileId && file.status === 'indexed')
  }, 600_000, `file indexed ${fileId}`)
  const added = await stack.api('POST', `/v1/sectors/${sectorId}/global-context/files`, { fileId })
  expect(added.status).toBe(200)
  await stack.waitFor(async () => {
    const context = await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)
    const files = dataOf(context.body)['files'] as Array<{ fileId: string; state: string }>
    return files.some((file) => file.fileId === fileId && file.state === 'ready')
  }, 600_000, `block ready for ${fileId}`)
}

describe.skipIf(!LIVE_META_ENABLED)('live stage 2 (sections, switch, file blocks)', () => {
  let stack: LiveStack

  beforeAll(async () => {
    stack = await startLiveStack('stage2')
  }, 300_000)

  afterAll(async () => {
    await stack?.close()
  }, 120_000)

  it('L-A4/A5: six headings in context chats, none when the switch is off', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live context', topic: 'context', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const marker = 'LIVE MARKER QUAYSIDE'
    const patched = await stack.api('PATCH', `/v1/sectors/${sectorId}/global-context`, {
      baseVersion: 0,
      sections: {
        scope: `Scope ${marker} one.`, instructions: `Instructions ${marker} two.`, decisions: `Decisions ${marker} three.`,
        findings: `Findings ${marker} four.`, questions: `Questions ${marker} five.`,
      },
    })
    expect(patched.status).toBe(200)
    const mdId = await upload(stack, sectorId, 'market-notes.md')
    await addAndWaitReady(stack, sectorId, mdId)

    const chatA = dataOf((await stack.api('POST', '/v1/sessions', { title: 'Live chat A', sectorId })).body)['id'] as string
    const chatB = dataOf((await stack.api('POST', '/v1/sessions', { title: 'Live chat B', sectorId })).body)['id'] as string
    await sendAndWaitReply(stack, chatA, 'Say hello in one short sentence.')
    await sendAndWaitReply(stack, chatB, 'Say hello in one short sentence.')

    const promptB = await latestSystemPrompt(stack, chatB)
    for (const heading of ['## Scope', '## Instructions', '## Decisions', '## Findings', '## Open questions', '## Files']) {
      expect(promptB).toContain(heading)
    }
    expect(promptB).toContain(marker)

    const switched = await stack.api('PATCH', `/v1/sessions/${chatA}/settings`, { useGlobalContext: false })
    expect(switched.status).toBe(200)
    await sendAndWaitReply(stack, chatA, 'Say goodbye in one short sentence.')
    await sendAndWaitReply(stack, chatB, 'Say goodbye in one short sentence.')

    const promptA = await latestSystemPrompt(stack, chatA)
    expect(promptA).not.toContain(marker)
    expect(promptA).not.toContain('## Findings')
    expect(promptA).toContain(`sector id: ${sectorId}`)
    expect(await latestSystemPrompt(stack, chatB)).toContain(marker)
    const spendAfter = await stack.spend()
    console.log(`L-A4/A5 tries=1 input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)

  it('L-A6: real files become standardized blocks with every number kept', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live blocks', topic: 'blocks', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const mdId = await upload(stack, sectorId, 'market-notes.md')
    await upload(stack, sectorId, 'pricing.csv')
    const pdfId = await upload(stack, sectorId, 'report.pdf')
    const versionBefore = Number(dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['version'])

    await addAndWaitReady(stack, sectorId, mdId)
    await addAndWaitReady(stack, sectorId, pdfId)

    const context = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
    expect(Number(context['version'])).toBe(versionBefore + 2)
    const files = context['files'] as Array<{ fileId: string; state: string; summary: string; tokens: number }>
    const md = files.find((file) => file.fileId === mdId)
    const pdf = files.find((file) => file.fileId === pdfId)
    expect(md?.state).toBe('ready')
    expect(pdf?.state).toBe('ready')
    expect(validateBlockTemplate(md?.summary ?? '')).toEqual([])
    expect(validateBlockTemplate(pdf?.summary ?? '')).toEqual([])
    expect(md?.summary).toContain('market-notes.md (MD)')
    expect(pdf?.summary).toContain('report.pdf (PDF')
    const pdfPages = await stack.pool.query('SELECT COUNT(*)::int AS pages FROM sector_document_units WHERE document_id=$1 AND source_page IS NOT NULL', [pdfId])
    if (Number(pdfPages.rows[0]?.pages) > 0) expect(pdf?.summary).toContain('report.pdf (PDF,')

    const mdSource = readFileSync(join(FIXTURES, 'market-notes.md'), 'utf8')
    expect(extractNumberTokens(mdSource).length).toBeGreaterThanOrEqual(15)
    expect(findMissingNumbers(mdSource, md?.summary ?? '')).toEqual([])
    const pdfText = await stack.pool.query<{ text: string }>('SELECT text FROM sector_documents WHERE id=$1', [pdfId])
    const pdfSource = pdfText.rows[0]?.text ?? ''
    expect(extractNumberTokens(pdfSource).length).toBeGreaterThan(0)
    expect(findMissingNumbers(pdfSource, pdf?.summary ?? '')).toEqual([])

    const usage = await readGlobalContextUsage(stack.pool, sectorId, SCOPE)
    const byFile = new Map(usage.byFile.map((file) => [file.fileId, file.tokens]))
    expect(byFile.get(mdId)).toBe(md?.tokens)
    expect(byFile.get(pdfId)).toBe(pdf?.tokens)
    expect(usage.total).toBe(
      usage.bySection.scope + usage.bySection.instructions + usage.bySection.decisions + usage.bySection.findings
      + usage.bySection.questions + usage.byFile.reduce((sum, file) => sum + file.tokens, 0),
    )
    const spendAfter = await stack.spend()
    const blockSpend = await stack.pool.query<{ input_tokens: number; output_tokens: number }>(
      'SELECT input_tokens,output_tokens FROM context_file_blocks WHERE sector_id=$1', [sectorId])
    const blockInput = blockSpend.rows.reduce((sum, row) => sum + Number(row.input_tokens), 0)
    const blockOutput = blockSpend.rows.reduce((sum, row) => sum + Number(row.output_tokens), 0)
    console.log(`L-A6 tries=1 input=${spendAfter.inputTokens - spendBefore.inputTokens + blockInput} output=${spendAfter.outputTokens - spendBefore.outputTokens + blockOutput} (blocks in=${blockInput} out=${blockOutput})`)
  }, 600_000)

  it('L-A7: removing a file is instant and later turns lose its text', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live removal', topic: 'removal', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const mdId = await upload(stack, sectorId, 'market-notes.md')
    await addAndWaitReady(stack, sectorId, mdId)
    const files = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['files'] as Array<{ fileId: string; summary: string }>
    const summary = files.find((file) => file.fileId === mdId)?.summary ?? ''
    expect(summary).toContain('1,240')

    const started = Date.now()
    const removed = await stack.api('DELETE', `/v1/sectors/${sectorId}/global-context/files/${mdId}`)
    expect(Date.now() - started).toBeLessThan(500)
    expect(removed.status).toBe(200)
    const after = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
    expect((after['files'] as unknown[]).length).toBe(0)
    expect(String(after['markdown'] ?? '')).not.toContain('1,240')

    const sessionId = dataOf((await stack.api('POST', '/v1/sessions', { title: 'Live removal chat', sectorId })).body)['id'] as string
    await sendAndWaitReply(stack, sessionId, 'Say hello in one short sentence.')
    const prompt = await latestSystemPrompt(stack, sessionId)
    expect(prompt).not.toContain('1,240')
    expect(prompt).not.toContain('## Files')
    expect(prompt).toContain(`sector id: ${sectorId}`)
    const spendAfter = await stack.spend()
    console.log(`L-A7 tries=1 input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)

  it('L-A8: usage totals equal their stored parts', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live usage', topic: 'usage', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    await stack.api('PATCH', `/v1/sectors/${sectorId}/global-context`, {
      baseVersion: 0,
      sections: { scope: 'Live usage scope.', instructions: '', decisions: '', findings: '', questions: '' },
    })
    const mdId = await upload(stack, sectorId, 'market-notes.md')
    await addAndWaitReady(stack, sectorId, mdId)
    const context = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
    const usage = context['usage'] as { total: number; budget: number; method: string; bySection: Record<string, number>; byFile: Array<{ fileId: string; tokens: number }> }
    const files = context['files'] as Array<{ fileId: string; tokens: number }>
    expect(usage.method).toBe('estimated')
    expect(usage.budget).toBe(30000)
    expect(usage.byFile).toEqual([{ fileId: mdId, tokens: files.find((file) => file.fileId === mdId)?.tokens }])
    expect(usage.total).toBe(
      Object.values(usage.bySection).reduce((sum, tokens) => sum + tokens, 0) + usage.byFile.reduce((sum, file) => sum + file.tokens, 0),
    )
    expect(usage.total).toBeGreaterThan(0)
    const spendAfter = await stack.spend()
    const blockSpend = await stack.pool.query<{ input_tokens: number; output_tokens: number }>(
      'SELECT input_tokens,output_tokens FROM context_file_blocks WHERE sector_id=$1', [sectorId])
    const blockInput = blockSpend.rows.reduce((sum, row) => sum + Number(row.input_tokens), 0)
    const blockOutput = blockSpend.rows.reduce((sum, row) => sum + Number(row.output_tokens), 0)
    console.log(`L-A8 tries=1 input=${spendAfter.inputTokens - spendBefore.inputTokens + blockInput} output=${spendAfter.outputTokens - spendBefore.outputTokens + blockOutput} (blocks in=${blockInput} out=${blockOutput})`)
  }, 600_000)

  it('L-A9: auto compaction shrinks past 70% and restore returns the exact text', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live compaction', topic: 'compaction', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const mdId = await upload(stack, sectorId, 'market-notes.md')
    await addAndWaitReady(stack, sectorId, mdId)

    const scope = `SCOPE SENTINEL ALBATROSS-7. ${'Scope context sentence. '.repeat(900)}`.slice(0, 22000)
    const instructions = `INSTRUCTIONS SENTINEL BANYAN-3. ${'Instruction context sentence. '.repeat(750)}`.slice(0, 22000)
    const decisions = `Decision A: residential focus wins for coastal crews. Decision B: mid-size firms before independents. Decision C: fixed-price contracts over hourly. ${'Background discussion restating prior context with no new decisions. '.repeat(400)}`.slice(0, 20000)
    const numbered = Array.from({ length: 40 }, (_, i) => `Finding ${i}: route ticket ${1000 + i} paid $${(2000 + i * 7).toFixed(2)} on 2026-01-${String((i % 28) + 1).padStart(2, '0')}.`).join(' ')
    const findings = `${numbered} ${'Restated scheduling background with no new facts. '.repeat(500)}`.slice(0, 22400)
    const questions = `Should commercial weighting match residential? Which postcodes need licence rechecks? ${'Restated background with no new questions. '.repeat(90)}`.slice(0, 3000)
    const preBase = Number(dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['version'])
    const patched = await stack.api('PATCH', `/v1/sectors/${sectorId}/global-context`, {
      baseVersion: preBase, sections: { scope, instructions, decisions, findings, questions },
    })
    expect(patched.status).toBe(200)
    const full = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
    expect((full['usage'] as { total: number }).total).toBeGreaterThanOrEqual(21600)
    const versionBefore = Number(full['version'])
    const blockBefore = (full['files'] as Array<{ fileId: string; summary: string }>).find((file) => file.fileId === mdId)?.summary ?? ''

    const compactionVersions = async (): Promise<Array<{ version: number; sourceThread: string }>> => {
      const context = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
      return (context['changes'] as Array<{ author: string; version: number | null; sourceThread: string }>)
        .filter((change) => change.author === 'system:compaction' && change.version !== null)
        .map((change) => ({ version: change.version as number, sourceThread: change.sourceThread }))
    }
    await stack.waitFor(async () => (await compactionVersions()).length >= 1, 600_000, 'auto compaction version')
    const compacted = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
    const sections = compacted['sections'] as Record<string, string>
    expect(Number(compacted['version'])).toBe(versionBefore + 1)
    expect((compacted['usage'] as { total: number }).total).toBeLessThan(21000)
    expect(sections['scope']).toBe(scope)
    expect(sections['instructions']).toBe(instructions)
    expect((compacted['files'] as Array<{ fileId: string; summary: string }>).find((file) => file.fileId === mdId)?.summary).toBe(blockBefore)
    expect(findMissingNumbers([decisions, findings, questions].join('\n\n'), [sections['decisions'], sections['findings'], sections['questions']].join('\n\n'))).toEqual([])

    const restored = await stack.api('POST', `/v1/sectors/${sectorId}/global-context/restore`, { version: versionBefore })
    expect(restored.status).toBe(200)
    expect(dataOf(restored.body)['sections']).toEqual({ scope, instructions, decisions, findings, questions })
    await stack.waitFor(async () => (await compactionVersions()).length >= 2, 600_000, 'second auto compaction version')

    const manual = await stack.api('POST', `/v1/sectors/${sectorId}/global-context/compact`, {})
    expect(manual.status).toBe(200)
    expect(dataOf(manual.body)).toEqual({ started: true })
    await stack.waitFor(async () => (await compactionVersions()).length >= 3, 600_000, 'manual compaction version')
    const reasons = (await compactionVersions()).map((change) => change.sourceThread)
    expect(reasons).toContain('compaction:auto')
    expect(reasons).toContain('compaction:manual')
    const spendAfter = await stack.spend()
    const compactionSpend = await stack.pool.query<{ input_tokens: number; output_tokens: number }>(
      `SELECT input_tokens,output_tokens FROM workspace_changes WHERE sector_id=$1 AND author='system:compaction'`, [sectorId])
    const compactIn = compactionSpend.rows.reduce((sum, row) => sum + Number(row.input_tokens), 0)
    const compactOut = compactionSpend.rows.reduce((sum, row) => sum + Number(row.output_tokens), 0)
    console.log(`L-A9 tries=1 input=${spendAfter.inputTokens - spendBefore.inputTokens + compactIn} output=${spendAfter.outputTokens - spendBefore.outputTokens + compactOut} (compactions in=${compactIn} out=${compactOut})`)
  }, 600_000)

  it('L-A10: a rewrite direction ends in one pending proposal', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live rewrite', topic: 'rewrite', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    const sections = {
      scope: 'Live rewrite scope.',
      instructions: '',
      decisions: 'We focus on residential customers first.',
      findings: 'Residential demand is strong. Residential installers report growth. Residential pilots convert well.',
      questions: 'Which residential segment should we target next?',
    }
    const patched = await stack.api('PATCH', `/v1/sectors/${sectorId}/global-context`, { baseVersion: 0, sections })
    expect(patched.status).toBe(200)
    const versionBefore = Number(dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['version'])
    const before = JSON.stringify(sections)
    const beforeCount = (before.match(/commercial/gi) ?? []).length

    const instruction = 'The context leans toward residential customers; give equal weight to commercial customers.'
    const started = await stack.api('POST', `/v1/sectors/${sectorId}/global-context/rewrite`, { instruction })
    expect(started.status).toBe(200)
    const sessionId = dataOf(started.body)['sessionId'] as string
    const session = await stack.api('GET', `/v1/sessions/${sessionId}`)
    expect(String(dataOf(session.body)['title'] ?? '')).toMatch(/^Context rewrite: /)
    const settings = await stack.pool.query<{ purpose: string }>('SELECT purpose FROM session_settings WHERE session_id=$1', [sessionId])
    expect(settings.rows[0]?.purpose).toBe('context-rewrite')

    type Change = { sourceThread: string; state: string; sections: Record<string, string> }
    const pendingFromRewrite = async (): Promise<Change[]> => {
      const context = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
      return (context['changes'] as Change[]).filter((change) => change.sourceThread === sessionId && change.state === 'pending')
    }
    await stack.waitFor(async () => (await pendingFromRewrite()).length >= 1, 600_000, 'rewrite proposal')
    // Let a second proposal land if the agent misbehaves, then count exactly.
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    const proposals = await pendingFromRewrite()
    expect(proposals).toHaveLength(1)
    const proposed = JSON.stringify(proposals[0]?.sections ?? {})
    expect((proposed.match(/commercial/gi) ?? []).length).toBeGreaterThan(beforeCount)
    expect(Number(dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['version'])).toBe(versionBefore)
    expect(await agentCount(stack, sessionId)).toBeGreaterThan(0)
    const spendAfter = await stack.spend()
    console.log(`L-A10 tries=1 input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)

  it('L-A2/A12: agent context writes stay pending until the owner approves', async () => {
    const spendBefore = await stack.spend()
    const sectorId = (await createSector(stack.pool, { name: 'Live proposals', topic: 'proposals', scope: SCOPE })).sectorId
    await projectNewEvents(stack.pool)
    await stack.api('PATCH', `/v1/sectors/${sectorId}/global-context`, {
      baseVersion: 0,
      sections: { scope: 'Live proposals scope.', instructions: '', decisions: '', findings: '', questions: '' },
    })
    const versionBefore = Number(dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['version'])

    type Change = { id: string; sourceThread: string; state: string; sections: Record<string, string> }
    const pendingFrom = async (threadKey: string): Promise<Change[]> => {
      const context = dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)
      return (context['changes'] as Change[]).filter((change) => change.sourceThread === threadKey && change.state === 'pending')
    }
    const sessionId = dataOf((await stack.api('POST', '/v1/sessions', { title: 'Live proposal chat', sectorId })).body)['id'] as string
    const wordings = [
      'From now on focus only on companies with more than 50 staff; remember this for all chats.',
      'Please remember for every chat in this sector: focus only on companies with more than 50 staff. Propose a global context update.',
      'Call db.propose_global_context now: add to Instructions that we focus only on companies with more than 50 staff.',
    ]
    let tries = 0
    let proposals: Change[] = []
    for (const wording of wordings) {
      tries += 1
      await sendAndWaitReply(stack, sessionId, wording)
      proposals = (await pendingFrom(sessionId)).filter((change) => change.sections['instructions'] || change.sections['decisions'])
      if (proposals.length > 0) break
    }
    expect(proposals.length).toBeGreaterThan(0)
    expect(Number(dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['version'])).toBe(versionBefore)
    const approved = await stack.api('POST', `/v1/sectors/${sectorId}/global-context/proposals/${proposals[0]?.id}/decision`, { approve: true })
    expect(approved.status).toBe(200)
    expect(Number(dataOf((await stack.api('GET', `/v1/sectors/${sectorId}/global-context`)).body)['version'])).toBe(versionBefore + 1)

    const research = dataOf((await stack.api('POST', `/v1/sectors/${sectorId}/research-session`, {})).body)['id'] as string
    await sendAndWaitReply(stack, research, 'Propose a global context update adding this finding: pilot customers prefer quarterly billing.')
    const researchProposals = await pendingFrom(research)
    expect(researchProposals.length).toBeGreaterThan(0)
    expect(researchProposals[0]?.sections['findings']).toContain('quarterly')
    const spendAfter = await stack.spend()
    console.log(`L-A2/A12 tries=${tries} input=${spendAfter.inputTokens - spendBefore.inputTokens} output=${spendAfter.outputTokens - spendBefore.outputTokens}`)
  }, 600_000)
})
