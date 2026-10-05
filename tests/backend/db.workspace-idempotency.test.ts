// Workspace retry-safety and input validation (stub Db, no database).
// Proves commit replays return the first result, file-context proposals
// validate ids up front, artifact indexing validates names, and global
// reads carry the caller scope into the sector lookup.
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { DbContractError, type TransactableDb } from '../../backend/src/db/index.js'
import { commitChildContext, proposeFileContext } from '../../backend/src/db/workspace-global-context.js'
import { indexSectorArtifact } from '../../backend/src/db/event-artifacts.js'
import { workspaceReferences } from '../../backend/src/db/workspace-research.js'

const SECTIONS = { scope: 'Widgets', decisions: '', findings: '', questions: '' }

function changeRow(id: string, state: string, version: number | null) {
  return {
    id, sector_id: 'sec-1', base_version: 1, sections: SECTIONS, source_thread: 'agent:child-1',
    author: 'research', state, version, at: '2026-01-01T00:00:00.000Z', file_ref: null,
  }
}

function stubDb(captured: { text: string; params: unknown[] }[]): TransactableDb {
  return {
    connect: async () => ({}) as unknown as PoolClient,
    async query<TRow>(text: string, params: unknown[] = []): Promise<{ rowCount: number | null; rows: TRow[] }> {
      captured.push({ text, params })
      if (text.includes('SELECT * FROM threads WHERE key')) {
        return {
          rowCount: 1,
          rows: [{ key: 'sess-1', session_id: 'sess-1', kind: 'session', status: 'RUNNING', accepting_steer: true, queue_depth: 0, updated_at: new Date('2026-01-01T00:00:00.000Z') }] as unknown as TRow[],
        }
      }
      if (text.includes('FROM thread_messages')) return { rowCount: 0, rows: [] }
      if (text.includes('FROM created c')) {
        return {
          rowCount: 1,
          rows: [{ id: 'sess-1', title: 'Research', sector: 'sec-1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }] as unknown as TRow[],
        }
      }
      if (text.includes('FROM sectors s')) {
        return {
          rowCount: 1,
          rows: [{ id: 'sec-1', name: 'Widgets', topic: 'Widgets', state: 'running', companies_found: 0, research_session_id: 'sess-1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }] as unknown as TRow[],
        }
      }
      if (text.includes('FROM sector_workspace WHERE research_session_id')) {
        return { rowCount: 1, rows: [{ sector_id: 'sec-1' }] as unknown as TRow[] }
      }
      if (text.includes('FROM sector_workspace WHERE sector_id')) {
        return { rowCount: 0, rows: [] }
      }
      if (text.includes('FROM workspace_changes WHERE id=$1')) {
        // Commit replay probe: the parent commit already landed approved.
        if (params[0] === 'parent-commit:c1') return { rowCount: 1, rows: [changeRow('parent-commit:c1', 'approved', 2)] as unknown as TRow[] }
        return { rowCount: 1, rows: [changeRow('c1', 'approved', 2)] as unknown as TRow[] }
      }
      if (text.includes('FROM workspace_changes WHERE sector_id')) return { rowCount: 0, rows: [] }
      if (text.includes('FROM workspace_files')) return { rowCount: 0, rows: [] }
      if (text.includes('FROM sector_documents WHERE')) return { rowCount: 0, rows: [] }
      return { rowCount: 0, rows: [] }
    },
  }
}

const SCOPE = { tenantId: 'tenant-ws', projectId: null }

describe('workspace retry-safety and validation [F:db.workspace_global_context.proposeFileContext] [F:db.workspace_research.workspaceReferences] [F:db.index.DbContractError] [F:db.workspace_global_context.commitChildContext] [F:db.errors.DbContractError] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.workspace.ContextFileRef] [F:db.context_files.listContextFileBlocks] [F:db.context_files.markContextFileBlockFailed] [F:db.context_files.mergeFileRefs] [F:db.context_files.recordThreadFileExposure] [F:db.context_files.validateFileRefs] [F:db.document_units.listDocumentUnitOrdinals] [F:db.errors.WorkspaceError] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.workspace_global_context.assertGlobalFileContext] [F:db.workspace_global_context.previewContextChange] [F:db.workspace.requireSector] [F:db.sessions.sessionKind] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked] [F:db.workspace.workspaceRow] [F:db.file_jobs.visible]', () => {
  it('replays an approved child commit instead of re-guarding', async () => {
    const captured: { text: string; params: unknown[] }[] = []
    const result = await commitChildContext(stubDb(captured), 'sess-1', 'c1', SCOPE)
    expect(result).toMatchObject({ id: 'parent-commit:c1', state: 'approved', version: 2 })
    // No proposal write on replay: the outcome is read, not re-entered.
    expect(captured.some((call) => call.text.includes('INSERT INTO workspace_changes'))).toBe(false)
  })

  it('validates file-context ids before any read', async () => {
    const captured: { text: string; params: unknown[] }[] = []
    await expect(
      proposeFileContext(stubDb(captured), { sectorId: 'sec-1', fileId: '', baseVersion: 0, sourceThread: 'sess-1', scope: SCOPE }),
    ).rejects.toBeInstanceOf(DbContractError)
    expect(captured).toEqual([])
  })

  it('validates artifact names before any write', async () => {
    const captured: { text: string; params: unknown[] }[] = []
    await expect(indexSectorArtifact(stubDb(captured), 'sec-1', 'art-1', '', 'body', SCOPE)).rejects.toThrow(
      'name must be a non-empty string',
    )
    expect(captured).toEqual([])
  })

  it('carries the caller scope into the global sector lookup', async () => {
    const captured: { text: string; params: unknown[] }[] = []
    await workspaceReferences(stubDb(captured), 'sec-1', SCOPE)
    const lookup = captured.find((call) => call.text.includes('FROM sectors s'))
    expect(lookup).toBeDefined()
    expect(JSON.stringify(lookup?.params)).toContain('tenant-ws')
  })
})
