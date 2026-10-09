// Sector-sweep activities (Phase 6): the bounded steps the sectorSweep
// workflow orchestrates. Each activity owns its pool from env like the
// turn activities; every write is idempotent (deterministic keys), so
// retries and re-sweeps replay instead of duplicating.
import { z } from 'zod'
import type { Scope } from '../../auth/types.js'
import {
  DbContractError,
  getSector,
  listSectorDocuments,
  registerSectorDiscovery,
  setSectorState,
  registerLedgerCandidate,
  workerPoolFromEnv,
} from '../../db/index.js'
import { projectNewEvents } from '../../projector.js'
import {
  linksFromSnapshot as linksFromSnapshotPool,
  pooledSearchWebPage,
  type SweepSearchDeps as PoolSearchDeps,
  type SweepSearchHit as PoolSearchHit,
  type SweepSearchVia as PoolSearchVia,
} from '../../browserPool/facade.js'

const SectorId = z.string().min(1)

export interface SweepContext {
  sectorId: string
  name: string
  topic: string
  state: string
  /** Leading document text for query shaping, capped server-side. */
  docChars: number
  docText: string
}

/** Load the sector plus capped context text for query shaping. */
export async function loadSweepContextActivity(input: {
  sectorId: string
  scope?: Scope
}): Promise<SweepContext> {
  if (!SectorId.safeParse(input.sectorId).success) throw new DbContractError('sectorId must be non-empty')
  // The worker pool is process-shared (workerPoolFromEnv): activities must
  // never end it — the first activity to finish would kill every later one.
  const pool = workerPoolFromEnv()
  await projectNewEvents(pool)
  const sector = await getSector(pool, input.sectorId, input.scope)
  if (!sector) throw new DbContractError(`unknown sector ${input.sectorId}`)
  const docs = await listSectorDocuments(pool, input.sectorId, input.scope)
  const docText = docs
    .map((doc) => doc.filename)
    .join(' ')
    .slice(0, 2000)
  return { sectorId: sector.id, name: sector.name, topic: sector.topic, state: sector.state, docChars: 0, docText }
}

export type SweepSearchVia = PoolSearchVia

export type SweepSearchHit = PoolSearchHit

/** Injectable legs for the fallback chain (tests stub these; the
 * workflow always runs the defaults). */
export type SweepSearchDeps = PoolSearchDeps

/** Candidate URLs out of an aria snapshot (canonical impl lives in the
 * browser-pool facade; re-exported here so existing import paths hold). */
export const linksFromSnapshot = linksFromSnapshotPool

/** One search page for a template: delegates to the browser-pool facade
 * (keyed first, keyless second, pooled Chromium last with page-0-only
 * termination), preserving the injectable-leg contract for tests. */
export async function searchWebPageActivity(
  input: { query: string; page: number },
  deps: SweepSearchDeps = {},
): Promise<SweepSearchHit[]> {
  return pooledSearchWebPage(input, deps)
}


export interface SweepCompany {
  domain: string
  name: string
  url: string
  sectorName: string
}

/** Record one discovered company: master ledger upsert (domain-deduped)
 * plus the sector projection event (timeline progress). Deterministic
 * ids/keys make re-sweeps replay. */
export async function recordSweepCompanyActivity(input: {
  sectorId: string
  company: SweepCompany
  scope?: Scope
}): Promise<{ companyId: string }> {
  const pool = workerPoolFromEnv()
  await projectNewEvents(pool)
  await registerLedgerCandidate(pool, {
    domain: input.company.domain,
    name: input.company.name,
    sector: input.company.sectorName,
    qualificationReason: `sector sweep: ${input.company.url}`,
  })
  const { companyId } = await registerSectorDiscovery(pool, {
    sectorId: input.sectorId,
    name: input.company.name,
    domain: input.company.domain,
    scope: input.scope,
  })
  await projectNewEvents(pool)
  return { companyId }
}

/** Terminal transition for the sweep: running -> complete | failed. */
export async function setSweepStateActivity(input: {
  sectorId: string
  state: 'running' | 'complete' | 'failed'
  scope?: Scope
}): Promise<void> {
  if (!SectorId.safeParse(input.sectorId).success) throw new DbContractError('sectorId must be non-empty')
  const pool = workerPoolFromEnv()
  await setSectorState(pool, input.sectorId, input.state, { scope: input.scope })
  await projectNewEvents(pool)
}
