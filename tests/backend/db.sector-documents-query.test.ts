// Dual-mode document query (query_document): TOC summary by default,
// targeted unit search/slice on demand. Stub-Db tests: no database, no
// Temporal. Proves summary shape without full-text leak, query/ords
// slicing, and unknown-document/sector rejection.
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import type { TransactableDb } from '../../backend/src/db/index.js'
import { DbContractError } from '../../backend/src/db/index.js'
import { querySectorDocument } from '../../backend/src/db/sector-documents.js'

const UNITS = [
  { document_id: 'sdoc-1', ord: 0, kind: 'heading', text: 'Pricing overview', confidence: null, uncertain: false, sha256: 'a' },
  { document_id: 'sdoc-1', ord: 1, kind: 'text', text: 'The entry diagnostic costs one fixed fee and expands to a managed data layer.', confidence: null, uncertain: false, sha256: 'b' },
  { document_id: 'sdoc-1', ord: 2, kind: 'text', text: 'Target buyers run RevOps at fifty to five hundred staff.', confidence: null, uncertain: false, sha256: 'c' },
]

function stubDb(state: { sector: boolean; doc: boolean }): TransactableDb {
  return {
    connect: async () => ({}) as unknown as PoolClient,
    async query<TRow>(text: string, params: unknown[] = []): Promise<{ rowCount: number | null; rows: TRow[] }> {
      void params
      if (text.includes('FROM sectors s')) {
        return {
          rowCount: state.sector ? 1 : 0,
          rows: (state.sector
            ? [{
                id: 'sec-1', name: 'Foods', topic: 'Packaged', state: 'draft',
                companies_found: 0, research_session_id: null,
                created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
              }]
            : []) as unknown as TRow[],
        }
      }
      if (text.includes('FROM sector_documents')) {
        return {
          rowCount: state.doc ? 1 : 0,
          rows: (state.doc
            ? [{ id: 'sdoc-1', sector_id: 'sec-1', filename: 'brief.md', media_type: 'text/markdown', text: 'full text', status: 'indexed' }]
            : []) as unknown as TRow[],
        }
      }
      if (text.includes('FROM sector_document_units')) {
        if (text.includes('ILIKE')) {
          return { rowCount: 1, rows: [UNITS[1]] as unknown as TRow[] }
        }
        if (text.includes('ANY')) {
          return { rowCount: 1, rows: [UNITS[2]] as unknown as TRow[] }
        }
        return { rowCount: UNITS.length, rows: UNITS as unknown as TRow[] }
      }
      return { rowCount: 0, rows: [] }
    },
  }
}

const SCOPE = { tenantId: 't', projectId: null }

describe('querySectorDocument', () => {
  it('summarizes with a TOC and no full-text leak', async () => {
    const result = await querySectorDocument(stubDb({ sector: true, doc: true }), {
      documentId: 'sdoc-1',
      sectorId: 'sec-1',
      scope: SCOPE,
    })
    expect(result).toMatchObject({ documentId: 'sdoc-1', filename: 'brief.md', totalUnits: 3 })
    if (!('toc' in result)) throw new Error('expected summary shape')
    expect(result.toc).toHaveLength(3)
    expect(result.toc[0]).toMatchObject({ ord: 0, kind: 'heading' })
    // Previews are capped slices, never the whole unit text.
    for (const entry of result.toc) expect(entry.preview.length).toBeLessThanOrEqual(150)
  })

  it('searches targeted chunks by query text', async () => {
    const result = await querySectorDocument(stubDb({ sector: true, doc: true }), {
      documentId: 'sdoc-1',
      sectorId: 'sec-1',
      mode: 'chunks',
      query: 'diagnostic',
      scope: SCOPE,
    })
    if (!('units' in result)) throw new Error('expected chunks shape')
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ ord: 1 })
  })

  it('slices exact units by ord', async () => {
    const result = await querySectorDocument(stubDb({ sector: true, doc: true }), {
      documentId: 'sdoc-1',
      sectorId: 'sec-1',
      ords: [2],
      scope: SCOPE,
    })
    if (!('units' in result)) throw new Error('expected chunks shape')
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ ord: 2 })
  })

  it('resolves the owning sector when sectorId is absent', async () => {
    const result = await querySectorDocument(stubDb({ sector: true, doc: true }), {
      documentId: 'sdoc-1',
      scope: SCOPE,
    })
    expect(result.documentId).toBe('sdoc-1')
  })

  it('rejects unknown documents, invisible sectors, and empty ids', async () => {
    const noDoc = stubDb({ sector: true, doc: false })
    await expect(querySectorDocument(noDoc, { documentId: 'sdoc-1', sectorId: 'sec-1', scope: SCOPE })).rejects.toBeInstanceOf(
      DbContractError,
    )
    const noSector = stubDb({ sector: false, doc: true })
    await expect(
      querySectorDocument(noSector, { documentId: 'sdoc-1', sectorId: 'sec-1', scope: SCOPE }),
    ).rejects.toBeInstanceOf(DbContractError)
    await expect(
      querySectorDocument(stubDb({ sector: true, doc: true }), { documentId: '', sectorId: 'sec-1', scope: SCOPE }),
    ).rejects.toBeInstanceOf(DbContractError)
  })
})
