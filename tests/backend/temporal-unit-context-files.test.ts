// Pure unit tests for the context-file factory: summarize paths (single and
// multi chunk, repair rounds, spend) and global compaction (JSON repair,
// missing-number repair, shrink gate, conflict stand-down). No database.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { emptyUsage } from '@kardata/agents'
import { WorkspaceError } from '../../backend/src/db/errors.js'
import {
  CONTEXT_FILE_MODEL,
  compactGlobalContextActivity,
  createContextFileActivities,
  summarizeContextFileActivity,
} from '../../backend/src/temporal/activities/context-files.js'

const db = vi.hoisted(() => ({
  pool: {},
  rounds: vi.fn(),
  block: vi.fn(),
  units: vi.fn(),
  blocks: vi.fn(),
  failed: vi.fn(),
  applyBlock: vi.fn(),
  applyCompaction: vi.fn(),
  context: vi.fn(),
  usage: vi.fn(),
  spend: vi.fn(),
}))
vi.mock('../../backend/src/db/execution-rounds.js', () => ({ appendProviderRoundEvent: db.rounds }))
vi.mock('../../backend/src/db/document-units.js', () => ({ listDocumentUnits: db.units }))
vi.mock('../../backend/src/db/context-files.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/context-files.js')>()),
  readContextFileBlock: db.block,
  listContextFileBlocks: db.blocks,
  markContextFileBlockFailed: db.failed,
}))
vi.mock('../../backend/src/db/workspace-global-context.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/workspace-global-context.js')>()),
  applyReadyContextFileBlock: db.applyBlock,
  applySystemCompaction: db.applyCompaction,
  readGlobalContext: db.context,
  readGlobalContextUsage: db.usage,
  recordContextAiUsage: db.spend,
}))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  workerPoolFromEnv: () => db.pool,
}))

afterEach(() => { vi.clearAllMocks() })

function scriptedProvider(texts: Array<string | Error>) {
  const calls: string[] = []
  return {
    calls,
    adapter: {
      providerName: 'fake',
      chat: async (request: { messages: Array<{ text: string }> }) => {
        calls.push(request.messages.map((m) => m.text).join('\n'))
        const next = texts.shift()
        if (next instanceof Error) throw next
        if (next === undefined) throw new Error('provider out of scripted replies')
        return { text: next, usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 5 } }
      },
    },
  }
}

function block(overrides: Record<string, unknown> = {}) {
  return {
    sectorId: 'sec-1', fileId: 'file-1', documentId: 'doc-1', hash: 'hash-1',
    filename: 'report.pdf', state: 'summarizing', summary: '', tokens: 0, error: null,
    requestedBy: 'owner', addedVersion: null, inputTokens: 0, outputTokens: 0, ...overrides,
  }
}

function validSummary(filename = 'report.pdf', facts = 'Revenue was 42 dollars in 2024.'): string {
  return [
    `### ${filename} (PDF, 1 pages)`,
    '**Overview.** Quarterly revenue report.',
    '**Key facts**',
    `- ${facts}`,
    '**Entities**',
    '- Companies: Acme ; People: none ; Places: none',
    '**Tables and data**',
    'None',
    '**Gaps or unclear parts**',
    '- None',
    `Source: full original in Files ▸ ${filename}`,
  ].join('\n')
}

function activities(provider: { adapter: unknown }, startCompaction?: (sectorId: string) => Promise<void>) {
  return createContextFileActivities({ db: db.pool as never, provider: () => provider.adapter as never, ...(startCompaction ? { startCompaction } : {}) })
}

describe('summarizeContextFileActivity [F:backend.activity.context_files.buildContextFilePrompt] [F:backend.activity.context_files.createContextFileActivities] [F:backend.activity.context_files.summarizeContextFileActivity] [F:backend.activity.context_files.compactGlobalContextActivity]', () => {
  it('stays removed when the block is gone or re-added', async () => {
    db.block.mockResolvedValue(undefined)
    const p = scriptedProvider(['unused'])
    await expect(activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).resolves.toEqual({ applied: false })
    db.block.mockResolvedValue(block({ hash: 'hash-2' }))
    await expect(activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).resolves.toEqual({ applied: false })
    expect(p.calls).toEqual([])
  })
  it('fails a file with no readable units', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([])
    const p = scriptedProvider(['unused'])
    await expect(activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).resolves.toEqual({ applied: false })
    expect(db.failed).toHaveBeenCalledWith(db.pool, 'sec-1', 'file-1', 'file has no readable units')
    expect(p.calls).toEqual([])
  })
  it('summarizes one chunk, records the round, and bills the spend', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'Revenue was 42 dollars in 2024.', page: 1 }])
    db.applyBlock.mockResolvedValue({ version: 3 })
    db.usage.mockResolvedValue({ total: 10, budget: 100 })
    const p = scriptedProvider([validSummary()])
    const startCompaction = vi.fn(async () => undefined)
    const result = await activities(p, startCompaction).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })
    expect(result).toEqual({ applied: true })
    expect(p.calls).toHaveLength(1)
    expect(p.calls[0]).toContain('### report.pdf (PDF, 1 pages)')
    expect(db.rounds).toHaveBeenCalledWith(db.pool, 'sector:sec-1', expect.stringContaining('provider-round:file-summary:file-1'), expect.objectContaining({ round: 1, attempt: 1, model: CONTEXT_FILE_MODEL, outcome: 'ok', inputTokens: 10, outputTokens: 5 }))
    expect(db.spend).toHaveBeenCalledWith(db.pool, { sectorId: 'sec-1', idempotencyKey: expect.stringContaining('ai-usage:'), usage: { kind: 'file-summary', fileId: 'file-1', inputTokens: 10, outputTokens: 5, model: CONTEXT_FILE_MODEL } })
    expect(startCompaction).not.toHaveBeenCalled()
  })
  it('merges partial notes across chunks', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([
      { ord: 0, text: `${'A'.repeat(30000)} 11`, page: 1 },
      { ord: 1, text: `${'B'.repeat(30000)} 22`, page: 2 },
    ])
    db.applyBlock.mockResolvedValue({ version: 3 })
    db.usage.mockResolvedValue({ total: 10, budget: 100 })
    const p = scriptedProvider(['notes one', 'notes two', validSummary('report.pdf', 'Figures 11 and 22 carried.')])
    const result = await activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })
    expect(result).toEqual({ applied: true })
    expect(p.calls).toHaveLength(3)
    expect(p.calls[0]).toContain('part 1 of 2')
    expect(p.calls[1]).toContain('part 2 of 2')
    expect(p.calls[2]).toContain('Merge these partial notes')
    expect(db.rounds).toHaveBeenCalledTimes(3)
  })
  it('repairs missing numbers and template defects in one round', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'Revenue was 42 dollars in 2024.', page: 1 }])
    db.applyBlock.mockResolvedValue({ version: 3 })
    db.usage.mockResolvedValue({ total: 10, budget: 100 })
    const defective = validSummary().replace('Revenue was 42 dollars in 2024.', 'Revenue was redacted.').replace('**Entities**\n', '')
    const p = scriptedProvider([defective, validSummary()])
    const result = await activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })
    expect(result).toEqual({ applied: true })
    expect(p.calls).toHaveLength(2)
    expect(p.calls[1]).toContain('Missing exact value 42')
    expect(p.calls[1]).toContain('Template:')
    expect(db.applyBlock).toHaveBeenCalledWith(db.pool, expect.objectContaining({ summary: validSummary() }))
  })
  it('appends still-missing figures instead of dropping them', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'Revenue was 42 dollars in 2024.', page: 1 }])
    db.applyBlock.mockResolvedValue({ version: 3 })
    db.usage.mockResolvedValue({ total: 10, budget: 100 })
    const partial = validSummary('report.pdf', 'Revenue was 42 dollars, year redacted.')
    const p = scriptedProvider([partial, partial])
    await activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })
    const applied = db.applyBlock.mock.calls[0]?.[1] as { summary: string }
    expect(applied.summary).toContain('**Additional figures**')
    expect(applied.summary).toContain('2024')
  })
  it('triggers compaction once the summary pushes usage past the threshold', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'plain text', page: null }])
    db.applyBlock.mockResolvedValue({ version: 3 })
    db.usage.mockResolvedValue({ total: 80, budget: 100 })
    const p = scriptedProvider([validSummary('report.pdf', 'plain text carried.')])
    const startCompaction = vi.fn(async () => undefined)
    await activities(p, startCompaction).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })
    expect(startCompaction).toHaveBeenCalledWith('sec-1')
  })
  it('records a timeout round and marks the block failed when the provider hangs', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'plain text', page: null }])
    const p = scriptedProvider([new Error('provider call timed out after 180000ms')])
    await expect(activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).rejects.toThrow('timed out')
    expect(db.rounds).toHaveBeenCalledWith(db.pool, 'sector:sec-1', expect.any(String), expect.objectContaining({ outcome: 'timeout', errorCode: 'provider_timeout' }))
    expect(db.failed).toHaveBeenCalledWith(db.pool, 'sec-1', 'file-1', 'provider call timed out after 180000ms')
  })
  it('records an error round when the provider fails fast', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'plain text', page: null }])
    const p = scriptedProvider([Object.assign(new Error('overloaded'), { code: 'provider_overloaded' })])
    await expect(activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).rejects.toThrow('overloaded')
    expect(db.rounds).toHaveBeenCalledWith(db.pool, 'sector:sec-1', expect.any(String), expect.objectContaining({ outcome: 'error', errorCode: 'provider_overloaded' }))
  })
  it('still applies when the round journal write fails', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'plain text', page: null }])
    db.applyBlock.mockResolvedValue({ version: 3 })
    db.usage.mockResolvedValue({ total: 10, budget: 100 })
    db.rounds.mockRejectedValueOnce(new Error('journal down'))
    const p = scriptedProvider([validSummary('report.pdf', 'plain text carried.')])
    await expect(activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).resolves.toEqual({ applied: true })
  })
  it('reports a late removal as not applied', async () => {
    db.block.mockResolvedValue(block())
    db.units.mockResolvedValue([{ ord: 0, text: 'plain text', page: null }])
    db.applyBlock.mockResolvedValue(null)
    const p = scriptedProvider([validSummary('report.pdf', 'plain text carried.')])
    await expect(activities(p).summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).resolves.toEqual({ applied: false })
  })
})

describe('compactGlobalContextActivity', () => {
  function context(sections: { decisions: string; findings: string; questions: string }) {
    return { version: 7, sections: { scope: 's', instructions: 'i', ...sections }, usage: { total: 90, budget: 100 } }
  }
  it('stands a stale auto trigger down but always runs manual', async () => {
    db.usage.mockResolvedValue({ total: 10, budget: 100 })
    const p = scriptedProvider(['unused'])
    await expect(activities(p).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).resolves.toEqual({ compacted: false })
    expect(p.calls).toEqual([])
    db.context.mockResolvedValue(context({ decisions: 'keep this decision', findings: 'keep this finding', questions: 'keep this question' }))
    db.blocks.mockResolvedValue([])
    db.applyCompaction.mockResolvedValue({ version: 8 })
    const q = scriptedProvider([JSON.stringify({ decisions: 'd', findings: 'f', questions: 'q' })])
    await expect(activities(q).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'manual' })).resolves.toEqual({ compacted: true, version: 8 })
  })
  it('compacts and bills the spend', async () => {
    db.usage.mockResolvedValue({ total: 90, budget: 100 })
    db.context.mockResolvedValue(context({ decisions: 'decide alpha then beta', findings: 'found gamma and delta', questions: 'open epsilon and zeta' }))
    db.blocks.mockResolvedValue([])
    db.applyCompaction.mockResolvedValue({ version: 8 })
    const p = scriptedProvider([JSON.stringify({ decisions: 'alpha beta', findings: 'gamma', questions: 'epsilon' })])
    const result = await activities(p).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })
    expect(result).toEqual({ compacted: true, version: 8 })
    expect(db.applyCompaction).toHaveBeenCalledWith(db.pool, expect.objectContaining({ sectorId: 'sec-1', baseVersion: 7, reason: 'auto', sections: { decisions: 'alpha beta', findings: 'gamma', questions: 'epsilon' } }))
    expect(db.spend).toHaveBeenCalledWith(db.pool, expect.objectContaining({ sectorId: 'sec-1', usage: expect.objectContaining({ kind: 'compaction', model: CONTEXT_FILE_MODEL }) }))
  })
  it('retries once on invalid JSON, then fails honestly', async () => {
    db.usage.mockResolvedValue({ total: 90, budget: 100 })
    db.context.mockResolvedValue(context({ decisions: 'decide alpha', findings: 'found beta', questions: 'open gamma' }))
    db.blocks.mockResolvedValue([])
    db.applyCompaction.mockResolvedValue({ version: 8 })
    const p = scriptedProvider(['not json at all', JSON.stringify({ decisions: 'd', findings: 'f', questions: 'q' })])
    await expect(activities(p).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).resolves.toEqual({ compacted: true, version: 8 })
    expect(p.calls[1]).toContain('Return ONLY valid JSON')
    const q = scriptedProvider(['garbage one', 'garbage two'])
    await expect(activities(q).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).rejects.toThrow('Compaction did not return valid section JSON.')
  })
  it('repairs dropped figures, appending what the repair still misses', async () => {
    db.usage.mockResolvedValue({ total: 90, budget: 100 })
    db.context.mockResolvedValue(context({
      decisions: 'budget 42 approved after long deliberation with many stakeholders across several quarters of careful review and debate',
      findings: 'found beta among many other candidate items reviewed at length with extensive supporting notes attached below',
      questions: 'open gamma plus several follow-up questions still pending owner review in the next scheduled session',
    }))
    db.blocks.mockResolvedValue([])
    db.applyCompaction.mockResolvedValue({ version: 8 })
    const p = scriptedProvider([
      JSON.stringify({ decisions: 'budget approved', findings: 'beta', questions: 'gamma' }),
      JSON.stringify({ decisions: 'budget 42 approved', findings: 'beta', questions: 'gamma' }),
    ])
    await activities(p).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })
    expect(p.calls[1]).toContain('42')
    expect(db.applyCompaction).toHaveBeenCalledWith(db.pool, expect.objectContaining({ sections: expect.objectContaining({ decisions: 'budget 42 approved' }) }))
    db.applyCompaction.mockClear()
    const q = scriptedProvider([
      JSON.stringify({ decisions: 'budget approved', findings: 'beta', questions: 'gamma' }),
      JSON.stringify({ decisions: 'still no figure here', findings: 'beta', questions: 'gamma' }),
    ])
    await activities(q).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })
    const applied = db.applyCompaction.mock.calls[0]?.[1] as { sections: { findings: string } }
    expect(applied.sections.findings).toContain('Additional figures')
    expect(applied.sections.findings).toContain('42')
  })
  it('refuses a compaction that does not shrink', async () => {
    db.usage.mockResolvedValue({ total: 90, budget: 100 })
    const sections = { decisions: 'd', findings: 'f', questions: 'q' }
    db.context.mockResolvedValue(context(sections))
    db.blocks.mockResolvedValue([])
    const p = scriptedProvider([JSON.stringify({ decisions: 'd padded padded padded', findings: 'f padded padded', questions: 'q padded padded' })])
    await expect(activities(p).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).rejects.toThrow('Compaction did not shrink the context.')
  })
  it('retries once on a concurrent change, then stands down silently', async () => {
    db.usage.mockResolvedValue({ total: 90, budget: 100 })
    db.context.mockResolvedValue(context({ decisions: 'decide alpha', findings: 'found beta', questions: 'open gamma' }))
    db.blocks.mockResolvedValue([])
    db.applyCompaction.mockRejectedValueOnce(new WorkspaceError('conflict', 'version moved')).mockResolvedValueOnce({ version: 9 })
    const p = scriptedProvider([
      JSON.stringify({ decisions: 'd', findings: 'f', questions: 'q' }),
      JSON.stringify({ decisions: 'd', findings: 'f', questions: 'q' }),
    ])
    await expect(activities(p).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).resolves.toEqual({ compacted: true, version: 9 })
    expect(p.calls).toHaveLength(2)
    db.applyCompaction.mockRejectedValue(new WorkspaceError('conflict', 'version moved again'))
    const q = scriptedProvider([
      JSON.stringify({ decisions: 'd', findings: 'f', questions: 'q' }),
      JSON.stringify({ decisions: 'd', findings: 'f', questions: 'q' }),
    ])
    await expect(activities(q).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).resolves.toEqual({ compacted: false })
  })
  it('rethrows non-conflict apply failures', async () => {
    db.usage.mockResolvedValue({ total: 90, budget: 100 })
    db.context.mockResolvedValue(context({ decisions: 'decide alpha', findings: 'found beta', questions: 'open gamma' }))
    db.blocks.mockResolvedValue([])
    const failure = new Error('store down')
    db.applyCompaction.mockRejectedValueOnce(failure)
    const p = scriptedProvider([JSON.stringify({ decisions: 'd', findings: 'f', questions: 'q' })])
    await expect(activities(p).compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).rejects.toBe(failure)
  })
})

describe('production context-file activities', () => {
  it('fails the block honestly when the provider cannot be built', async () => {
    const saved = process.env['KARDATA_META_KEY']
    delete process.env['KARDATA_META_KEY']
    try {
      db.block.mockResolvedValue(block())
      db.units.mockResolvedValue([{ ord: 0, text: 'plain text', page: null }])
      await expect(summarizeContextFileActivity({ sectorId: 'sec-1', fileId: 'file-1', hash: 'hash-1' })).rejects.toThrow()
      expect(db.failed).toHaveBeenCalledWith(db.pool, 'sec-1', 'file-1', expect.stringContaining('KARDATA_META_KEY'))
    } finally {
      if (saved === undefined) delete process.env['KARDATA_META_KEY']
      else process.env['KARDATA_META_KEY'] = saved
    }
  })
  it('stands a stale production auto compaction down', async () => {
    db.usage.mockResolvedValue({ total: 10, budget: 100 })
    await expect(compactGlobalContextActivity({ sectorId: 'sec-1', reason: 'auto' })).resolves.toEqual({ compacted: false })
  })
})
