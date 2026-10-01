// Sector research repository (B-S2). Reads serve the projection tables
// (migration 0007); writes append sector.*/company.* events and let the
// projector upsert, exactly like sessions/threads. Every read is
// scope-filtered: with a scope, only the caller's tenant (and selected
// project) is visible.
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { appendEvent, findEventByKey, readPartition } from './events.js'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

export const SECTOR_CREATED_EVENT = 'sector.created'
export const SECTOR_STATE_CHANGED_EVENT = 'sector.state_changed'
export const SECTOR_RESEARCH_STARTED_EVENT = 'sector.research_started'
export const SECTOR_PLAN_WRITTEN_EVENT = 'sector.plan_written'
export const SECTOR_PLAN_APPROVED_EVENT = 'sector.plan_approved'
export const COMPANY_FOUND_EVENT = 'company.found'
export const COMPANY_STAGE_CHANGED_EVENT = 'company.stage_changed'
export const COMPANY_STATE_CHANGED_EVENT = 'company.state_changed'

/** Draft is create-first: a sector shaped in chat with context files
 * attached, planned and approved explicitly, started only after approval.
 * Companies never draft (their table check excludes it); the shared enum
 * keeps one state vocabulary. */
export const SectorState = z.enum([
  'draft',
  'planning',
  'planned',
  'approved',
  'running',
  'paused',
  'queued',
  'failed',
  'complete',
])
export type SectorState = z.infer<typeof SectorState>

/** Legal sector transitions (plan-mandatory lifecycle). Drafts plan;
 * only owner-approved plans queue. Everything else is the contract the
 * planning, approval, and run surfaces build against. */
export const SECTOR_TRANSITIONS: Record<SectorState, readonly SectorState[]> = {
  draft: ['planning'],
  planning: ['planned', 'failed'],
  planned: ['approved', 'failed'],
  approved: ['queued'],
  queued: ['running', 'failed'],
  running: ['paused', 'complete', 'failed'],
  paused: ['running', 'planned'],
  failed: ['planning', 'running'],
  complete: [],
}

/** Throws unless from→to is a legal sector transition. */
export function assertSectorTransition(from: SectorState, to: SectorState): void {
  if (!SECTOR_TRANSITIONS[from].includes(to)) {
    throw new DbContractError(`not a legal sector transition: ${from} -> ${to}`)
  }
}

export const CompanyStage = z.enum(['Filter', 'Deep research', 'Problem found', 'Final validation'])
export type CompanyStage = z.infer<typeof CompanyStage>

export interface SectorRecord {
  id: string
  name: string
  topic: string
  state: SectorState
  companiesFound: number
  /** Chat session that started the research (pins it); null until an
   * agent start records one. Identity only: exclusivity stays on state. */
  researchSessionId: string | null
  createdAt: string
  updatedAt: string
}

export interface CompanyRecord {
  id: string
  sectorId: string
  sectorName: string
  name: string
  stage: CompanyStage
  state: SectorState
  createdAt: string
  updatedAt: string
}

export interface ActivityEntry {
  seq: number
  text: string
}

const SectorCreatedPayload = z.object({
  sectorId: z.string().min(1),
  name: z.string().min(1),
  topic: z.string().optional(),
  state: SectorState.optional(),
  tenantId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
})

const SectorStateChangedPayload = z.object({
  sectorId: z.string().min(1),
  state: SectorState,
})

const SectorResearchStartedPayload = z.object({
  sectorId: z.string().min(1),
  sessionId: z.string().min(1),
})

const CompanyFoundPayload = z.object({
  companyId: z.string().min(1),
  sectorId: z.string().min(1),
  name: z.string().min(1),
  stage: CompanyStage.optional(),
  state: SectorState.optional(),
  tenantId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
})

const CompanyStageChangedPayload = z.object({
  companyId: z.string().min(1),
  stage: CompanyStage,
})

const CompanyStateChangedPayload = z.object({
  companyId: z.string().min(1),
  state: SectorState,
})

/** Projection handler for the six sector/company event types. Upserts are
 * idempotent (replay-safe); state transitions UPDATE rows that creation
 * projected first — writers read the projection, so unknown ids fail at
 * the repo, never here. Returns false for foreign types. */
export async function projectSectorEvent(
  db: Db,
  event: { type: string; payload: unknown; at: string },
): Promise<boolean> {
  switch (event.type) {
    case SECTOR_CREATED_EVENT: {
      const payload = SectorCreatedPayload.parse(event.payload)
      await db.query(
        `INSERT INTO sectors (id, name, topic, state, tenant_id, project_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          payload.sectorId,
          payload.name,
          payload.topic ?? '',
          payload.state ?? 'queued',
          payload.tenantId ?? null,
          payload.projectId ?? null,
          event.at,
        ],
      )
      return true
    }
    case SECTOR_STATE_CHANGED_EVENT: {
      const payload = SectorStateChangedPayload.parse(event.payload)
      await db.query(
        'UPDATE sectors SET state = $2, updated_at = $3::timestamptz WHERE id = $1',
        [payload.sectorId, payload.state, event.at],
      )
      return true
    }
    case SECTOR_RESEARCH_STARTED_EVENT: {
      const payload = SectorResearchStartedPayload.parse(event.payload)
      await db.query(
        'UPDATE sectors SET research_session_id = $2, updated_at = $3::timestamptz WHERE id = $1',
        [payload.sectorId, payload.sessionId, event.at],
      )
      return true
    }
    case COMPANY_FOUND_EVENT: {
      const payload = CompanyFoundPayload.parse(event.payload)
      await db.query(
        `INSERT INTO companies (id, sector_id, name, stage, state, tenant_id, project_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          payload.companyId,
          payload.sectorId,
          payload.name,
          payload.stage ?? 'Filter',
          payload.state ?? 'running',
          payload.tenantId ?? null,
          payload.projectId ?? null,
          event.at,
        ],
      )
      return true
    }
    case COMPANY_STAGE_CHANGED_EVENT: {
      const payload = CompanyStageChangedPayload.parse(event.payload)
      await db.query(
        'UPDATE companies SET stage = $2, updated_at = $3::timestamptz WHERE id = $1',
        [payload.companyId, payload.stage, event.at],
      )
      return true
    }
    case COMPANY_STATE_CHANGED_EVENT: {
      const payload = CompanyStateChangedPayload.parse(event.payload)
      await db.query(
        'UPDATE companies SET state = $2, updated_at = $3::timestamptz WHERE id = $1',
        [payload.companyId, payload.state, event.at],
      )
      return true
    }
    default:
      return false
  }
}

const KeySchema = z.string().min(1)
const QuerySchema = z.string().max(200)

interface SectorRow {
  id: string
  name: string
  topic: string
  state: string
  companies_found: number | string
  research_session_id: string | null
  created_at: Date | string
  updated_at: Date | string
}

interface CompanyRow {
  id: string
  sector_id: string
  sector_name: string
  name: string
  stage: string
  state: string
  created_at: Date | string
  updated_at: Date | string
}

function toSectorRecord(row: SectorRow): SectorRecord {
  const state = SectorState.safeParse(row.state)
  if (!state.success) throw new DbContractError(`sector ${row.id} carries unknown state`)
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    state: state.data,
    companiesFound: Number(row.companies_found),
    researchSessionId:
      typeof row.research_session_id === 'string' && row.research_session_id !== ''
        ? row.research_session_id
        : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function toCompanyRecord(row: CompanyRow): CompanyRecord {
  const stage = CompanyStage.safeParse(row.stage)
  if (!stage.success) throw new DbContractError(`company ${row.id} carries unknown stage`)
  const state = SectorState.safeParse(row.state)
  if (!state.success) throw new DbContractError(`company ${row.id} carries unknown state`)
  return {
    id: row.id,
    sectorId: row.sector_id,
    sectorName: row.sector_name,
    name: row.name,
    stage: stage.data,
    state: state.data,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/** Scope predicate with the table alias baked in: callers splice the
 * clause verbatim (no extra prefix), so joins never go ambiguous. */
function scopeFilter(
  alias: string,
  scope: Scope | undefined,
  start: number,
): { clause: string; params: unknown[] } {
  if (!scope) return { clause: '', params: [] }
  return {
    clause: `${alias}.tenant_id = $${start} AND ($${start + 1}::text IS NULL OR ${alias}.project_id = $${start + 1})`,
    params: [scope.tenantId, scope.projectId],
  }
}

export interface SectorFilters {
  state?: SectorState
  query?: string
}

/** Read-path paging: bounded windows with truthful totals. Defaults keep
 * existing callers safe (first 100 rows); the cap stops full-table reads
 * at thousand-row scale. Invalid windows throw before any SQL. */
export interface Paging {
  limit?: number
  offset?: number
}

export const PAGING_DEFAULT_LIMIT = 100
export const PAGING_MAX_LIMIT = 500

function parsePaging(paging: Paging = {}): { limit: number; offset: number } {
  const limit = paging.limit ?? PAGING_DEFAULT_LIMIT
  const offset = paging.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGING_MAX_LIMIT) {
    throw new DbContractError(`limit must be an integer 1-${PAGING_MAX_LIMIT}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DbContractError('offset must be a non-negative integer')
  }
  return { limit, offset }
}

function parseFilters(filters: SectorFilters = {}): { state?: SectorState; query?: string } {
  if (filters.state !== undefined && !SectorState.safeParse(filters.state).success) {
    throw new DbContractError('state must be a known research state')
  }
  if (filters.query !== undefined && !QuerySchema.safeParse(filters.query).success) {
    throw new DbContractError('query must be at most 200 characters')
  }
  return { state: filters.state, query: filters.query?.trim() || undefined }
}

/** Sector list with live company counts. Text filter matches name/topic. */
export async function listSectors(
  db: Db,
  scope?: Scope,
  filters: SectorFilters = {},
): Promise<SectorRecord[]> {
  const { state, query } = parseFilters(filters)
  const scoped = scopeFilter('s', scope, 1)
  const conditions: string[] = []
  const params: unknown[] = [...scoped.params]
  if (scoped.clause) conditions.push(scoped.clause)
  if (state) {
    params.push(state)
    conditions.push(`s.state = $${params.length}`)
  }
  if (query) {
    params.push(`%${query}%`)
    conditions.push(`(s.name ILIKE $${params.length} OR s.topic ILIKE $${params.length})`)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await db.query<SectorRow>(
    `SELECT s.id AS id, s.name AS name, s.topic AS topic, s.state AS state,
       (SELECT COUNT(*) FROM companies c WHERE c.sector_id = s.id) AS companies_found,
       s.research_session_id AS research_session_id,
       s.created_at AS created_at, s.updated_at AS updated_at
     FROM sectors s ${where} ORDER BY s.updated_at DESC`,
    params,
  )
  return rows.map(toSectorRecord)
}

export async function getSector(db: Db, sectorId: string, scope?: Scope): Promise<SectorRecord | undefined> {
  if (!KeySchema.safeParse(sectorId).success) throw new DbContractError('sectorId must be non-empty')
  const scoped = scopeFilter('s', scope, 2)
  const params: unknown[] = [sectorId, ...scoped.params]
  const where = scoped.clause ? `AND ${scoped.clause}` : ''
  const { rows } = await db.query<SectorRow>(
    `SELECT s.id AS id, s.name AS name, s.topic AS topic, s.state AS state,
       (SELECT COUNT(*) FROM companies c WHERE c.sector_id = s.id) AS companies_found,
       s.research_session_id AS research_session_id,
       s.created_at AS created_at, s.updated_at AS updated_at
     FROM sectors s WHERE s.id = $1 ${where}`,
    params,
  )
  const row = rows[0]
  return row ? toSectorRecord(row) : undefined
}

export interface CompanyFilters extends SectorFilters {
  sectorId?: string
}

/** Companies in one sector. Text filter matches the company name. */
export async function listSectorCompanies(
  db: Db,
  sectorId: string,
  scope?: Scope,
  filters: SectorFilters = {},
  paging: Paging = {},
): Promise<{ companies: CompanyRecord[]; total: number }> {
  if (!KeySchema.safeParse(sectorId).success) throw new DbContractError('sectorId must be non-empty')
  return listCompanies(db, scope, { ...filters, sectorId }, paging)
}

/** Tenant-wide company list with owning sector names. */
export async function listCompanies(
  db: Db,
  scope?: Scope,
  filters: CompanyFilters = {},
  paging: Paging = {},
): Promise<{ companies: CompanyRecord[]; total: number }> {
  const { state, query } = parseFilters(filters)
  const { limit, offset } = parsePaging(paging)
  if (filters.sectorId !== undefined && !KeySchema.safeParse(filters.sectorId).success) {
    throw new DbContractError('sectorId must be non-empty')
  }
  const scoped = scopeFilter('c', scope, 1)
  const conditions: string[] = []
  const params: unknown[] = [...scoped.params]
  if (scoped.clause) conditions.push(scoped.clause)
  if (filters.sectorId) {
    params.push(filters.sectorId)
    conditions.push(`c.sector_id = $${params.length}`)
  }
  if (state) {
    params.push(state)
    conditions.push(`c.state = $${params.length}`)
  }
  if (query) {
    params.push(`%${query}%`)
    conditions.push(`c.name ILIKE $${params.length}`)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const counted = await db.query<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM companies c JOIN sectors s ON s.id = c.sector_id ${where}`,
    params,
  )
  const total = Number(counted.rows[0]?.total ?? 0)
  const { rows } = await db.query<CompanyRow>(
    `SELECT c.id AS id, c.sector_id AS sector_id, s.name AS sector_name, c.name AS name,
       c.stage AS stage, c.state AS state, c.created_at AS created_at, c.updated_at AS updated_at
     FROM companies c JOIN sectors s ON s.id = c.sector_id
     ${where} ORDER BY c.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  return { companies: rows.map(toCompanyRecord), total }
}

/** Activity timeline derived from the sector's event partition: the state
 * pill and the timeline can never disagree because both read one log.
 * Paged like company reads; the total counts mapped entries, so a window
 * never passes as the whole timeline. */
export async function sectorActivity(
  db: Db,
  sectorId: string,
  scope?: Scope,
  paging: Paging = {},
): Promise<{ entries: ActivityEntry[]; total: number }> {
  if (!KeySchema.safeParse(sectorId).success) throw new DbContractError('sectorId must be non-empty')
  const { limit, offset } = parsePaging(paging)
  const sector = await getSector(db, sectorId, scope)
  if (!sector) throw new DbContractError(`unknown sector ${sectorId}`)
  const events = await readPartition(db, `sector:${sectorId}`)
  const entries: ActivityEntry[] = []
  for (const event of events) {
    const payload = event.payload as Record<string, unknown> | null
    if (event.type === SECTOR_CREATED_EVENT) {
      const topic = typeof payload?.['topic'] === 'string' && payload['topic'] !== '' ? payload['topic'] : sector.topic
      entries.push({ seq: event.seq, text: `Research started for ${topic}.` })
    } else if (event.type === SECTOR_STATE_CHANGED_EVENT) {
      const state = SectorState.safeParse(payload?.['state'])
      if (!state.success) continue
      const text =
        state.data === 'paused'
          ? 'Paused by the owner.'
          : state.data === 'failed'
            ? 'Discovery failed while fetching sources.'
            : state.data === 'complete'
              ? 'Discovery finished. List is final.'
              : state.data === 'running'
                ? 'Research running.'
                : 'Research queued.'
      entries.push({ seq: event.seq, text })
    } else if (event.type === COMPANY_FOUND_EVENT) {
      if (typeof payload?.['name'] === 'string') {
        entries.push({ seq: event.seq, text: `${payload['name']} found.` })
      }
    } else if (event.type === COMPANY_STAGE_CHANGED_EVENT) {
      const stage = CompanyStage.safeParse(payload?.['stage'])
      if (typeof payload?.['name'] === 'string' && stage.success) {
        entries.push({ seq: event.seq, text: `${payload['name']} moved to ${stage.data}.` })
      }
    }
  }
  return { entries: entries.slice(offset, offset + limit), total: entries.length }
}

export async function createSector(
  db: Db,
  input: {
    name: string
    topic?: string
    scope?: Scope
    idempotencyKey?: string
    sectorId?: string
    /** Creation state. Defaults to queued (existing behavior); the HTTP
     * create route and the sector-draft skill pass draft. */
    initialState?: SectorState
  },
): Promise<{ sectorId: string }> {
  if (!KeySchema.safeParse(input.name).success) throw new DbContractError('name must be non-empty')
  const sectorId = input.sectorId ?? `sec-${randomUUID()}`
  if (!KeySchema.safeParse(sectorId).success) throw new DbContractError('sectorId must be non-empty')
  if (input.initialState !== undefined && !SectorState.safeParse(input.initialState).success) {
    throw new DbContractError('initialState must be a known research state')
  }
  await appendEvent(db, {
    idempotencyKey: input.idempotencyKey ?? `sector-created:${sectorId}`,
    partition: `sector:${sectorId}`,
    type: SECTOR_CREATED_EVENT,
    payload: {
      sectorId,
      name: input.name,
      topic: input.topic ?? '',
      state: input.initialState ?? 'queued',
      tenantId: input.scope?.tenantId ?? null,
      projectId: input.scope?.projectId ?? null,
    },
  })
  return { sectorId }
}

async function requireSector(db: Db, sectorId: string, scope?: Scope): Promise<void> {
  // Existence reads the projection: writers converge through the projector,
  // so a missing row means unknown (or not yet projected).
  const sector = await getSector(db, sectorId, scope)
  if (!sector) throw new DbContractError(`unknown sector ${sectorId}`)
}

export async function setSectorState(
  db: Db,
  sectorId: string,
  state: SectorState,
  options: { scope?: Scope; idempotencyKey?: string } = {},
): Promise<void> {
  if (!SectorState.safeParse(state).success) throw new DbContractError('state must be a known research state')
  await requireSector(db, sectorId, options.scope)
  await appendEvent(db, {
    idempotencyKey: options.idempotencyKey ?? `sector-state:${sectorId}:${randomUUID()}`,
    partition: `sector:${sectorId}`,
    type: SECTOR_STATE_CHANGED_EVENT,
    payload: { sectorId, state },
  })
}

/** Record which chat session started the research. Identity for the chat
 * pin; exclusivity stays on state (only drafts start), so recording never
 * gates anything. */
export async function recordResearchSession(
  db: Db,
  sectorId: string,
  sessionId: string,
  options: { scope?: Scope; idempotencyKey?: string } = {},
): Promise<void> {
  if (!KeySchema.safeParse(sessionId).success) throw new DbContractError('sessionId must be non-empty')
  await requireSector(db, sectorId, options.scope)
  await appendEvent(db, {
    idempotencyKey: options.idempotencyKey ?? `sector-research-session:${sectorId}:${sessionId}`,
    partition: `sector:${sectorId}`,
    type: SECTOR_RESEARCH_STARTED_EVENT,
    payload: { sectorId, sessionId },
  })
}

export type SectorTransitionFailure = 'not_found' | 'conflict' | 'overload'

export class SectorTransitionError extends Error {
  readonly failure: SectorTransitionFailure

  constructor(failure: SectorTransitionFailure, message: string) {
    super(message)
    this.failure = failure
  }
}

/** Owner pause: running -> paused. State transition only — the run
 * lifecycle (halt before state) lives in db/sector-lifecycle.ts, which
 * routes and tools must use instead of calling this directly. Anything
 * else is a conflict. */
export async function pauseSectorResearch(
  db: Db,
  sectorId: string,
  options: { scope?: Scope; idempotencyKey?: string } = {},
): Promise<SectorRecord> {
  const sector = await getSector(db, sectorId, options.scope)
  if (!sector) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  if (sector.state !== 'running') {
    throw new SectorTransitionError('conflict', `sector ${sectorId} is ${sector.state}, not running`)
  }
  await setSectorState(db, sectorId, 'paused', options)
  const paused = await getSector(db, sectorId, options.scope)
  if (!paused) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  return paused
}

/** Owner resume: paused -> running. Anything else is a conflict. */
export async function resumeSectorResearch(
  db: Db,
  sectorId: string,
  options: { scope?: Scope; idempotencyKey?: string } = {},
): Promise<SectorRecord> {
  const sector = await getSector(db, sectorId, options.scope)
  if (!sector) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  if (sector.state !== 'paused') {
    throw new SectorTransitionError('conflict', `sector ${sectorId} is ${sector.state}, not paused`)
  }
  await setSectorState(db, sectorId, 'running', options)
  const running = await getSector(db, sectorId, options.scope)
  if (!running) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  return running
}

export async function markCompanyFound(
  db: Db,
  input: {
    sectorId: string
    name: string
    stage?: CompanyStage
    state?: SectorState
    scope?: Scope
    idempotencyKey?: string
    companyId?: string
  },
): Promise<{ companyId: string }> {
  if (!KeySchema.safeParse(input.name).success) throw new DbContractError('name must be non-empty')
  const stage = input.stage ?? 'Filter'
  if (!CompanyStage.safeParse(stage).success) throw new DbContractError('stage must be a known stage')
  const state = input.state ?? 'running'
  if (!SectorState.safeParse(state).success) throw new DbContractError('state must be a known research state')
  await requireSector(db, input.sectorId, input.scope)
  const companyId = input.companyId ?? `com-${randomUUID()}`
  await appendEvent(db, {
    idempotencyKey: input.idempotencyKey ?? `company-found:${companyId}`,
    partition: `sector:${input.sectorId}`,
    type: COMPANY_FOUND_EVENT,
    payload: {
      companyId,
      sectorId: input.sectorId,
      name: input.name,
      stage,
      state,
      tenantId: input.scope?.tenantId ?? null,
      projectId: input.scope?.projectId ?? null,
    },
  })
  return { companyId }
}

/** Sector-local discovery identity; adopt legacy ids only for their owner. */
export async function registerSectorDiscovery(db: Db, input: { sectorId: string; domain: string; name: string; scope?: Scope }): Promise<{ companyId: string }> {
  await requireSector(db, input.sectorId, input.scope)
  if (!z.string().trim().min(1).max(253).safeParse(input.domain).success) throw new DbContractError('domain must be non-empty and at most 253 characters')
  const domain = input.domain.toLowerCase().replace(/^www\./, '')
  const legacy = await findEventByKey(db, `sweep-found:${input.sectorId}:${domain}`)
  const payload = legacy ? CompanyFoundPayload.safeParse(legacy.payload) : undefined
  if (payload?.success) {
    const owner = await db.query<{ sector_id: string }>('SELECT sector_id FROM companies WHERE id=$1', [payload.data.companyId])
    if (owner.rows[0]?.sector_id === input.sectorId) return { companyId: payload.data.companyId }
  }
  const companyId = `com-${createHash('sha256').update(JSON.stringify([input.sectorId, domain])).digest('hex').slice(0, 24)}`
  return markCompanyFound(db, { sectorId: input.sectorId, name: input.name, companyId, idempotencyKey: `discovery-found:${input.sectorId}:${domain}`, scope: input.scope })
}

async function requireCompany(
  db: Db,
  companyId: string,
  scope?: Scope,
): Promise<CompanyRecord> {
  const scoped = scopeFilter('c', scope, 2)
  const params: unknown[] = [companyId, ...scoped.params]
  const where = scoped.clause ? `AND ${scoped.clause}` : ''
  const { rows } = await db.query<CompanyRow>(
    `SELECT c.id AS id, c.sector_id AS sector_id, s.name AS sector_name, c.name AS name,
       c.stage AS stage, c.state AS state, c.created_at AS created_at, c.updated_at AS updated_at
     FROM companies c JOIN sectors s ON s.id = c.sector_id
     WHERE c.id = $1 ${where}`,
    params,
  )
  const row = rows[0]
  if (!row) throw new DbContractError(`unknown company ${companyId}`)
  return toCompanyRecord(row)
}

export async function setCompanyStage(
  db: Db,
  companyId: string,
  stage: CompanyStage,
  options: { scope?: Scope; idempotencyKey?: string } = {},
): Promise<void> {
  if (!CompanyStage.safeParse(stage).success) throw new DbContractError('stage must be a known stage')
  const company = await requireCompany(db, companyId, options.scope)
  await appendEvent(db, {
    idempotencyKey: options.idempotencyKey ?? `company-stage:${companyId}:${randomUUID()}`,
    partition: `sector:${company.sectorId}`,
    type: COMPANY_STAGE_CHANGED_EVENT,
    payload: { companyId, sectorId: company.sectorId, name: company.name, stage },
  })
}

export async function setCompanyState(
  db: Db,
  companyId: string,
  state: SectorState,
  options: { scope?: Scope; idempotencyKey?: string } = {},
): Promise<void> {
  if (!SectorState.safeParse(state).success) throw new DbContractError('state must be a known research state')
  const company = await requireCompany(db, companyId, options.scope)
  await appendEvent(db, {
    idempotencyKey: options.idempotencyKey ?? `company-state:${companyId}:${randomUUID()}`,
    partition: `sector:${company.sectorId}`,
    type: COMPANY_STATE_CHANGED_EVENT,
    payload: { companyId, sectorId: company.sectorId, state },
  })
}
