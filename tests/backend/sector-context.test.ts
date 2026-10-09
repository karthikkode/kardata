// Sector context assembly (Phase B). Stub-Db tests: no database, no
// network. Proves exclusion composition, citation format, note placement,
// and estimate accounting through getSectorContext.
import { describe, expect, it } from 'vitest'
import type { Db } from '../../backend/src/db/events.js'
import { getSectorContext } from '../../backend/src/db/sector-context.js'

interface StubState {
  exclusions: Array<{ document_id: string; unit_ord: number; excluded: boolean }>
  notes: Array<{ id: string; text: string; created_at: string }>
  docs?: Array<{ id: string; filename: string; status: string }>
}

const DEFAULT_DOCS = [{ id: 'sdoc-1', filename: 'notes.md', status: 'indexed' }]

function stubDb(state: StubState): Db {
  const docs = state.docs ?? DEFAULT_DOCS
  return {
    async query<TRow>(text: string): Promise<{ rowCount: number | null; rows: TRow[] }> {
      const rows = ((): unknown[] => {
        if (text.includes('FROM sectors s')) {
          return [{ id: 'sec-1', name: 'Optics', topic: 'Lenses', state: 'running', companies_found: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }]
        }
        if (text.includes('FROM sector_documents WHERE')) {
          return docs.map((doc) => ({
            id: doc.id, sector_id: 'sec-1', filename: doc.filename, media_type: 'text/plain',
            text: 'a\n\nb', sha256: 'abc', status: doc.status ?? 'indexed', created_at: '2026-01-01T00:00:00.000Z',
          }))
        }
        if (text.includes('FROM sector_document_units')) {
          return docs.flatMap((doc) => ([
            { document_id: doc.id, ord: 0, kind: 'heading', text: 'Title', confidence: null, uncertain: false, sha256: 'u0' },
            { document_id: doc.id, ord: 1, kind: 'text', text: 'Body fact.', confidence: null, uncertain: false, sha256: 'u1' },
          ]))
        }
        if (text.includes('FROM sector_context_selection')) return state.exclusions
        if (text.includes('FROM sector_context_notes')) return state.notes
        // Workspace file library: nothing hidden in these fixtures, so the
        // visibility join is a no-op and all assertions keep their shape.
        if (text.includes('FROM workspace_files')) return []
        throw new Error(`unexpected query: ${text.slice(0, 80)}`)
      })()
      return { rowCount: rows.length, rows: rows as TRow[] }
    },
  }
}

describe('getSectorContext [F:db.sector_context.getSectorContext] [F:db.index.Db]', () => {
  it('assembles digest-first cited references with estimates', async () => {
    const view = await getSectorContext(stubDb({ exclusions: [], notes: [] }), 'sec-1')
    expect(view.segments.system).toBe('Sector Optics: Lenses')
    expect(view.digest.version).toMatch(/^[0-9a-f]{12}$/)
    expect(view.digest.text).toBe('Sector Optics (running): Lenses. Documents: notes.md (indexed). Notes: 0.')
    expect(view.digest.text).not.toContain('[digest:')
    expect(view.segments.references[0]).toBe(view.digest.text)
    expect(view.segments.references.slice(1)).toEqual(['[notes.md:0] Title', '[notes.md:1] Body fact.'])
    expect(view.usage.totalEstimatedTokens).toBeGreaterThan(0)
    expect(view.files[0]?.units.every((unit) => !unit.excluded)).toBe(true)
  })

  it('disambiguates repeated filenames with a stable suffix', async () => {
    const view = await getSectorContext(
      stubDb({
        exclusions: [],
        notes: [],
        docs: [
          { id: 'sdoc-1', filename: 'notes.md', status: 'indexed' },
          { id: 'sdoc-2', filename: 'notes.md', status: 'indexed' },
        ],
      }),
      'sec-1',
    )
    expect(view.segments.references.slice(1)).toEqual([
      '[notes.md:0] Title',
      '[notes.md:1] Body fact.',
      '[notes.md (2):0] Title',
      '[notes.md (2):1] Body fact.',
    ])
    expect(view.digest.text).toContain('notes.md (indexed), notes.md (indexed)')
  })

  it('hides excluded units and whole documents from references', async () => {
    const unit = await getSectorContext(
      stubDb({ exclusions: [{ document_id: 'sdoc-1', unit_ord: 1, excluded: true }], notes: [] }),
      'sec-1',
    )
    expect(unit.segments.references.slice(1)).toEqual(['[notes.md:0] Title'])
    expect(unit.files[0]?.units[1]?.excluded).toBe(true)
    const doc = await getSectorContext(
      stubDb({ exclusions: [{ document_id: 'sdoc-1', unit_ord: -1, excluded: true }], notes: [] }),
      'sec-1',
    )
    expect(doc.segments.references).toEqual([doc.digest.text])
    expect(doc.files[0]?.excluded).toBe(true)
  })

  it('appends user notes after file references', async () => {
    const view = await getSectorContext(
      stubDb({
        exclusions: [],
        notes: [
          { id: 'snote-1', text: 'Watch pricing.', created_at: '2026-01-01T00:00:00.000Z' },
          { id: 'snote-2', text: 'Check churn.', created_at: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      'sec-1',
    )
    expect(view.segments.references.slice(-2)).toEqual(['[note:1] Watch pricing.', '[note:2] Check churn.'])
    expect(view.notes).toEqual([
      { id: 'snote-1', text: 'Watch pricing.', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'snote-2', text: 'Check churn.', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
  })
})
