// Corpus accuracy eval (KB migration). Grounded retrieval QA over the
// shipped knowledge_base corpus: each question names the expected topic
// and an anchor phrase that must appear in a top-3 hit. Corpus accuracy =
// passed / total; the suite pins 100% of this fixed set. Widen the set,
// never lower the bar. Live-DB gated like all repo suites.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordKbBatch, searchKb } from '../../backend/src/db/index.js'
import { collectKbDocs } from '../../backend/src/db/kb-ingest.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

interface EvalCase {
  question: string
  expectTopic: string
  anchor: string
}

const CASES: EvalCase[] = [
  { question: 'What does Kardata sell?', expectTopic: 'offer', anchor: 'managed data layer' },
  { question: 'How does the free wedge work?', expectTopic: 'offer', anchor: 'free' },
  { question: 'What is the monthly price band?', expectTopic: 'pricing', anchor: '$3k' },
  { question: 'What can we quote a prospect unprompted?', expectTopic: 'pricing', anchor: 'diagnostic' },
  { question: 'Tell me about the Ultimate tier', expectTopic: 'pricing', anchor: 'Ultimate' },
  { question: 'Is there a Performance tier?', expectTopic: 'pricing', anchor: 'Performance tier is removed' },
  { question: 'Who is the ideal customer?', expectTopic: 'icp', anchor: 'D2C' },
  { question: 'When do we walk away from a company?', expectTopic: 'icp', anchor: 'redundant' },
  { question: 'What makes a problem worthy?', expectTopic: 'problems', anchor: 'MECHANISM' },
  { question: 'A company runs ads to out-of-stock products; is research done?', expectTopic: 'problems', anchor: 'out-of-stock' },
  { question: 'What question must every proposed problem survive?', expectTopic: 'problems', anchor: '$3–6k/mo' },
  { question: 'When is a company qualified?', expectTopic: 'qualification', anchor: 'QUALIFIED' },
  { question: 'What are the three funnel phases?', expectTopic: 'funnel', anchor: 'Sector research' },
  { question: 'Who sends the emails?', expectTopic: 'funnel', anchor: 'never sends' },
  { question: 'How should outreach emails sound?', expectTopic: 'voice', anchor: 'surveillance' },
]

describe.skipIf(!ENABLED)('corpus accuracy (grounded retrieval QA)', () => {
  let pool: Pool

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_kb_eval')
    pool = new Pool({ connectionString: url })
    const docs = collectKbDocs(new URL('../../knowledge_base', import.meta.url).pathname)
    await recordKbBatch(pool, `kb-eval-${randomUUID().slice(0, 8)}`, docs)
  })

  afterAll(async () => {
    await pool.end()
  })

  it.each(CASES.map((c) => [c.question, c] as [string, EvalCase]))(
    'grounds %s',
    async (_question, evalCase) => {
      const hits = await searchKb(pool, evalCase.question, 3)
      expect(hits.some((hit) => hit.topic === evalCase.expectTopic)).toBe(true)
      expect(hits.some((hit) => hit.text.includes(evalCase.anchor))).toBe(true)
    },
  )

  it('reports corpus accuracy over the fixed set', async () => {
    let passed = 0
    for (const evalCase of CASES) {
      const hits = await searchKb(pool, evalCase.question, 3)
      if (
        hits.some((hit) => hit.topic === evalCase.expectTopic) &&
        hits.some((hit) => hit.text.includes(evalCase.anchor))
      ) {
        passed += 1
      }
    }
    const accuracy = passed / CASES.length
    console.log(`corpus accuracy: ${passed}/${CASES.length} = ${accuracy.toFixed(2)}`)
    expect(accuracy).toBe(1)
  })
})
