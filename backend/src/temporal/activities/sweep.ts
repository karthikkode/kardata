// Sector-sweep activities (Phase 6): the bounded steps the sectorSweep
// workflow orchestrates. Each activity owns its pool from env like the
// turn activities; every write is idempotent (deterministic keys), so
// retries and re-sweeps replay instead of duplicating.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../../auth/keys.js'
import {
  DbContractError,
  getSector,
  listSectorDocuments,
  markCompanyFound,
  setSectorState,
  upsertLedgerCompany,
  workerPoolFromEnv,
} from '../../db/index.js'
import { projectNewEvents } from '../../projector.js'
import { browserClose, browserNavigate } from '../../retrieval/browser.js'
import { keylessSearch, type KeylessHit } from '../../retrieval/keyless.js'
import { RetrievalError, webSearch, type SearchHit } from '../../retrieval/web.js'

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

export type SweepSearchVia = 'keyed' | 'keyless' | 'browser'

export interface SweepSearchHit {
  title: string
  url: string
  snippet: string
  /** Which fallback leg produced this page; absent means keyed. */
  via?: SweepSearchVia
  /** Keyless engine name when via is 'keyless'; absent otherwise. */
  engine?: string
}

/** Injectable legs for the fallback chain (tests stub these; the
 * workflow always runs the defaults). */
export interface SweepSearchDeps {
  keyed?: (query: string, page: number) => Promise<SearchHit[]>
  keyless?: (query: string, page: number) => Promise<KeylessHit[]>
  browser?: (query: string) => Promise<SweepSearchHit[]>
}

/** Search-engine hosts that must never become company candidates. */
const BROWSER_INTERNAL_HOSTS = [
  'duckduckgo.com',
  'lite.duckduckgo.com',
  'mojeek.com',
  'www.mojeek.com',
  'qwant.com',
  'www.qwant.com',
]

/** Candidate URLs out of an aria snapshot: bare links in document order,
 * deduped, engine-internal hosts dropped. Titles are hostnames — the
 * snapshot carries no titles, and inventing them would lie to the
 * ledger. Pure: unit-tested directly. */
export function linksFromSnapshot(snapshot: string, limit = 10): SweepSearchHit[] {
  const hits: SweepSearchHit[] = []
  const seen = new Set<string>()
  const pattern = /https?:\/\/[^\s"'<>)\]]+/g
  for (const match of snapshot.matchAll(pattern)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '')
    let host = ''
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      continue
    }
    if (BROWSER_INTERNAL_HOSTS.some((internal) => host === internal || host.endsWith(`.${internal}`))) continue
    if (seen.has(url)) continue
    seen.add(url)
    hits.push({ title: host, url, snippet: '', via: 'browser' })
    if (hits.length >= limit) break
  }
  return hits
}

/** Browser leg: real Chromium on the DDG html endpoint (the page curl
 * cannot reach past the anomaly wall), snapshot links out, session
 * always closed. */
async function browserSearchLeg(query: string): Promise<SweepSearchHit[]> {
  const { sessionId, snapshot } = await browserNavigate(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`,
  )
  try {
    return linksFromSnapshot(snapshot)
  } finally {
    await browserClose(sessionId).catch(() => undefined)
  }
}

/** One search page for a template: keyed Brave API first, keyless engine
 * pool second, real-Chromium browser leg last (page 0 only — deeper
 * pages return empty so the template terminates instead of re-driving
 * the browser). Exhaustion on every leg fails loudly, never an empty
 * list pretending to be exhaustive. */
export async function searchWebPageActivity(
  input: { query: string; page: number },
  deps: SweepSearchDeps = {},
): Promise<SweepSearchHit[]> {
  if (!Number.isInteger(input.page) || input.page < 0) throw new RetrievalError('validation_failed', 'page must be >= 0')
  if (input.query.trim().length < 2 || input.query.trim().length > 300) {
    throw new RetrievalError('validation_failed', 'query must be 2-300 characters')
  }
  const keyed = deps.keyed ?? ((query, page) => webSearch(process.env, query, { count: 10, page }))
  const keyless = deps.keyless ?? ((query, page) => keylessSearch(query, { count: 10, page }))
  const browser = deps.browser ?? browserSearchLeg

  if (process.env['KARDATA_WEB_SEARCH_KEY']?.trim()) {
    try {
      const hits = await keyed(input.query, input.page)
      if (hits.length > 0) return hits.map((hit) => ({ ...hit, via: 'keyed' as const }))
    } catch (error) {
      if (!(error instanceof RetrievalError)) throw error
    }
  }
  try {
    const hits = await keyless(input.query, input.page)
    if (hits.length > 0) {
      return hits.map((hit) => ({
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        via: 'keyless' as const,
        engine: hit.engine,
      }))
    }
  } catch (error) {
    if (!(error instanceof RetrievalError)) throw error
  }
  if (input.page > 0) return []
  try {
    return await browser(input.query)
  } catch (error) {
    throw new RetrievalError(
      'fetch_failed',
      `sweep search exhausted every leg: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}

function domainId(domain: string): string {
  return `com-${createHash('sha256').update(domain, 'utf8').digest('hex').slice(0, 12)}`
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
  await upsertLedgerCompany(pool, {
    domain: input.company.domain,
    name: input.company.name,
    sector: input.company.sectorName,
    qualificationReason: `sector sweep: ${input.company.url}`,
  })
  const { companyId } = await markCompanyFound(pool, {
    sectorId: input.sectorId,
    name: input.company.name,
    stage: 'Filter',
    state: 'running',
    companyId: domainId(input.company.domain),
    idempotencyKey: `sweep-found:${input.sectorId}:${input.company.domain}`,
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
