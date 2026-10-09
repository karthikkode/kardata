// Artifact reference contract (B-F3). Cross-session attach without byte
// copies: referenceArtifact links an indexed file into another session,
// resolveArtifactScope finds the owning scope, and listTenantArtifacts
// aggregates every session's files for attach discovery. Runs against the
// live database; without TEST_DATABASE_URL the suite skips explicitly.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import {
  storeAndIndex,
  storeArtifact,
  type ArtifactDeps,
  type ArtifactScope,
} from '../../backend/src/artifacts/pipeline.js'
import {
  appendEvent,
  createSession,
  DbContractError,
  findEventByKey,
  listArtifacts,
  listTenantArtifacts,
  referenceArtifact,
  resolveArtifactScope,
} from '../../backend/src/db/index.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { projectNewEvents } from '../../backend/src/projector.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const SCOPE = { tenantId: 'tenant-ref', projectId: null }

function deps(pool: Pool): ArtifactDeps {
  return {
    log: () => undefined,
    findEvent: (key) => findEventByKey(pool, key),
    record: (event) => appendEvent(pool, event).then(() => undefined),
  }
}

describe.skipIf(!ENABLED)('artifact references (B-F3) [F:db.index.appendEvent] [F:db.index.createSession] [F:db.index.findEventByKey] [F:db.index.DbContractError] [F:db.index.listArtifacts] [F:db.index.listTenantArtifacts] [F:db.index.referenceArtifact] [F:db.index.resolveArtifactScope] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.events.findEventByKey] [F:db.errors.DbContractError] [F:db.event_artifacts.listArtifacts] [F:db.event_artifacts.listTenantArtifacts] [F:db.event_artifacts.referenceArtifact] [F:db.event_artifacts.resolveArtifactScope] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.errors.ArtifactImportTimeout] [F:db.errors.WorkspaceError] [F:db.index.Db] [F:db.index.SECTOR_DOCUMENT_MAX_BYTES] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.sector_documents.hiddenFileIds] [F:db.errors.Id] [F:db.errors.checked] [F:db.file_jobs.visible] [F:db.events.KeySchema]', () => {
  let pool: Pool
  let target: FilesystemTarget
  let sessionA = ''
  let sessionB = ''
  let fileId = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_artifact_refs')
    pool = new Pool({ connectionString: url })
    target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-refs-')))
    sessionA = (await createSession(pool, 'ref source', SCOPE)).id
    sessionB = (await createSession(pool, 'ref target', SCOPE)).id
    const scope: ArtifactScope = { kind: 'session', id: sessionA }
    const indexed = await storeAndIndex(
      target,
      {
        scope,
        name: 'finding.md',
        body: 'shared finding',
        reason: 'subagent_output',
        producedBy: 'run-ref',
      },
      deps(pool),
    )
    fileId = indexed.artifactId
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('attaches an indexed file to another session without copying bytes', async () => {
    const summary = await referenceArtifact(pool, {
      artifactId: fileId,
      fromScope: { kind: 'session', id: sessionA },
      toSessionId: sessionB,
      scope: SCOPE,
    }, target)
    expect(summary).toMatchObject({
      artifactId: fileId,
      indexed: true,
      name: 'finding.md',
      reason: 'subagent_output',
      producedBy: 'run-ref',
      referencedFrom: { kind: 'session', id: sessionA },
    })
    // Re-reference is idempotent: same summary, no duplicate event.
    const again = await referenceArtifact(pool, {
      artifactId: fileId,
      fromScope: { kind: 'session', id: sessionA },
      toSessionId: sessionB,
      scope: SCOPE,
    }, target)
    expect(again).toEqual(summary)

    const listed = await listArtifacts(pool, sessionB)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      artifactId: fileId,
      referencedFrom: { kind: 'session', id: sessionA },
    })
  })
  it('does not let an authorized destination import a foreign tenant file', async () => {
    const foreignScope = { tenantId: 'test-foreign-artifact-tenant', projectId: null }
    const destination = await createSession(pool, 'TEST foreign destination', foreignScope)
    await projectNewEvents(pool)
    await expect(referenceArtifact(pool, { artifactId: fileId, fromScope: { kind: 'session', id: sessionA }, toSessionId: destination.id, scope: foreignScope })).rejects.toThrow(/authorized|unknown|outside/i)
    expect(await listArtifacts(pool, destination.id)).toEqual([])
  })

  it('resolves owning scopes for own and referenced files', async () => {
    await expect(resolveArtifactScope(pool, sessionA, fileId)).resolves.toEqual({
      scope: { kind: 'session', id: sessionA },
      referenced: false,
    })
    await expect(resolveArtifactScope(pool, sessionB, fileId)).resolves.toEqual({
      scope: { kind: 'session', id: sessionA },
      referenced: true,
    })
    await expect(resolveArtifactScope(pool, sessionB, 'art-missing')).resolves.toBeUndefined()
  })

  it('lists every session file for tenant attach discovery', async () => {
    const all = await listTenantArtifacts(pool, SCOPE)
    const ids = all.map((entry) => `${entry.sessionId}:${entry.artifactId}`)
    expect(ids).toContain(`${sessionA}:${fileId}`)
    expect(ids).toContain(`${sessionB}:${fileId}`)
    const foreign = await listTenantArtifacts(pool, { tenantId: 'tenant-stranger', projectId: null })
    expect(foreign).toEqual([])
  })

  it('refuses unknown sessions, unstored files, and unindexed files', async () => {
    await expect(
      referenceArtifact(pool, {
        artifactId: fileId,
        fromScope: { kind: 'session', id: sessionA },
        toSessionId: 'nope',
        scope: SCOPE,
      }),
    ).rejects.toBeInstanceOf(DbContractError)
    await expect(
      referenceArtifact(pool, {
        artifactId: 'art-never-stored',
        fromScope: { kind: 'session', id: sessionA },
        toSessionId: sessionB,
        scope: SCOPE,
      }),
    ).rejects.toBeInstanceOf(DbContractError)
    // Cross-tenant target session is invisible under the caller scope.
    await expect(
      referenceArtifact(pool, {
        artifactId: fileId,
        fromScope: { kind: 'session', id: sessionA },
        toSessionId: sessionB,
        scope: { tenantId: 'tenant-stranger', projectId: null },
      }),
    ).rejects.toBeInstanceOf(DbContractError)
    // Stored but never indexed: referenceable nowhere.
    const raw = await storeArtifact(
      target,
      {
        scope: { kind: 'session', id: sessionA },
        name: 'raw.md',
        body: 'unindexed',
        reason: 'user_upload',
        producedBy: 'test',
      },
      deps(pool),
    )
    await expect(
      referenceArtifact(pool, {
        artifactId: raw.artifactId,
        fromScope: { kind: 'session', id: sessionA },
        toSessionId: sessionB,
        scope: SCOPE,
      }),
    ).rejects.toBeInstanceOf(DbContractError)
  })
})
