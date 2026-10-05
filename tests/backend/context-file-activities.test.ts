// Direct-invocation cover for the context-file activity factory: the impls run
// here with a scripted provider and a real pool (the factory tolerates the
// missing worker context by design). Live-app suite, skipped explicitly
// without TEST_DATABASE_URL.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { FakeProvider, type FakeStep } from '@kardata/agents'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector } from '../../backend/src/db/index.js'
import { insertContextFileBlock, listContextFileBlocks } from '../../backend/src/db/context-files.js'
import { ingestSectorDocument } from '../../backend/src/db/sector-documents.js'
import {
  buildContextFilePrompt,
  createContextFileActivities,
} from '../../backend/src/temporal/activities/context-files.js'
import { decideContextChange, proposeGlobalContext, readGlobalContext } from '../../backend/src/db/workspace-global-context.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()

describe.skipIf(!ENABLED)('context-file activity factory over real db [F:backend.activity.context_files.buildContextFilePrompt] [F:backend.activity.context_files.createContextFileActivities] [F:backend.activity.context_files.summarizeContextFileActivity] [F:backend.activity.context_files.compactGlobalContextActivity]', () => {
  let pool: Pool
  const scope = { tenantId: `TEST context-file activities ${STAMP}`, projectId: null }
  const sector = `sec-context-file-${STAMP}`
  let seq = 0

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_context_file_activities') })
    await createSector(pool, { sectorId: sector, name: 'TEST context-file activities', topic: 'Widgets', scope })
    await projectNewEvents(pool)
  })
  afterAll(async () => { await pool?.end() })

  async function indexedBlock(mark: string): Promise<{ fileId: string; hash: string }> {
    seq += 1
    const doc = await ingestSectorDocument(pool, {
      sectorId: sector,
      filename: `test-block-${mark}-${seq}.md`,
      contentBase64: Buffer.from(`# TEST block ${mark}\nA synthetic unit for direct activity invocation, run ${seq}. No digits here.`).toString('base64'),
      scope,
    })
    const fileId = `TEST-block-${mark}-${seq}`
    const hash = `TEST-hash-${mark}-${seq}`
    await insertContextFileBlock(pool, { sectorId: sector, fileId, documentId: doc.id, hash, filename: doc.filename, requestedBy: 'TEST' })
    return { fileId, hash }
  }

  function factory(steps: FakeStep[]) {
    const provider = new FakeProvider(steps)
    const activities = createContextFileActivities({ db: pool, provider: () => provider })
    return { activities, provider }
  }

  it('summarizes an indexed file into a ready block', async () => {
    const { fileId, hash } = await indexedBlock('happy')
    const reply = '### TEST block (MD)\n**Overview.** TEST summary with enough words to look real.'
    const { activities, provider } = factory([{ text: reply }, { text: reply }, { text: reply }, { text: reply }, { text: reply }])
    const result = await activities.summarizeContextFileActivity({ sectorId: sector, fileId, hash })
    expect(result).toEqual({ applied: true })
    expect(provider.calls.length).toBeGreaterThan(0)
    const blocks = await listContextFileBlocks(pool, sector)
    const block = blocks.find((entry) => entry.fileId === fileId)
    expect(block?.state).toBe('ready')
    expect(block?.summary ?? '').toContain('TEST summary')
  })

  it('leaves removed and hash-mismatched blocks unapplied without provider calls', async () => {
    const { activities, provider } = factory([])
    expect(await activities.summarizeContextFileActivity({ sectorId: sector, fileId: 'TEST-no-such-file', hash: 'TEST-no-such-hash' })).toEqual({ applied: false })
    const { fileId } = await indexedBlock('mismatch')
    expect(await activities.summarizeContextFileActivity({ sectorId: sector, fileId, hash: 'TEST-wrong-hash' })).toEqual({ applied: false })
    expect(provider.calls.length).toBe(0)
  })

  it('marks the block failed when the provider throws', async () => {
    const { fileId, hash } = await indexedBlock('failing')
    const { activities } = factory([{ error: 'TEST provider down', retryable: false }])
    await expect(activities.summarizeContextFileActivity({ sectorId: sector, fileId, hash })).rejects.toThrow('TEST provider down')
    const blocks = await listContextFileBlocks(pool, sector)
    expect(blocks.find((entry) => entry.fileId === fileId)?.state).toBe('failed')
  })

  it('stands auto compaction down below budget', async () => {
    const { activities, provider } = factory([])
    const result = await activities.compactGlobalContextActivity({ sectorId: sector, reason: 'auto' })
    expect(result).toEqual({ compacted: false })
    expect(provider.calls.length).toBe(0)
  })

  it('rewrites long sections on manual compaction', async () => {
    const long = `TEST long section body without digits. ${'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(120)}`
    const current = await readGlobalContext(pool, sector, scope)
    const proposal = await proposeGlobalContext(pool, {
      sectorId: sector, baseVersion: current.version, sourceThread: 'TEST-compact-thread', owner: true, scope,
      sections: { decisions: long, findings: long, questions: long },
    })
    const decided = await decideContextChange(pool, { sectorId: sector, id: proposal.id, approve: true, scope })
    expect(decided.state).toBe('approved')
    const reply = JSON.stringify({ decisions: 'TEST short decisions.', findings: 'TEST short findings.', questions: 'TEST short questions.' })
    const { activities } = factory([{ text: reply }, { text: reply }, { text: reply }, { text: reply }, { text: reply }])
    const result = await activities.compactGlobalContextActivity({ sectorId: sector, reason: 'manual' })
    expect(result.compacted).toBe(true)
    const reread = await readGlobalContext(pool, sector, scope)
    expect(reread.sections.decisions).toBe('TEST short decisions.')
    expect(reread.version).toBeGreaterThan(current.version)
  })

  it('builds file prompts from filename, text and page line', async () => {
    const prompt = buildContextFilePrompt('evidence.md', 'chunk text here', '3 pages')
    expect(prompt).toContain('evidence.md')
    expect(prompt).toContain('chunk text here')
    expect(prompt).toContain('3 pages')
    expect(buildContextFilePrompt('evidence.md', 'chunk text here', null)).toContain('chunk text here')
  })
})
