// Company master-ledger repository (KB migration). ledger_companies is the
// cross-run canonical company record (identity, qualification, mailability,
// contacts); ledger_problems holds every researched problem per company with
// its evidence fields, so breadth ("find ALL problems") is structural, not
// advisory. Direct tables, not event projections: the ledger is
// master-accepted state curated by research runs and humans.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

export const LedgerQualification = z.enum(['unresearched', 'qualified', 'disqualified'])
export type LedgerQualification = z.infer<typeof LedgerQualification>

export const ProblemStatus = z.enum(['candidate', 'worthy', 'rejected'])
export type ProblemStatus = z.infer<typeof ProblemStatus>

export const UpsertCompanyInput = z.object({
  domain: z.string().min(1).max(253),
  name: z.string().min(1).max(200),
  sector: z.string().max(120).default(''),
  qualification: LedgerQualification.default('unresearched'),
  qualificationReason: z.string().max(2000).default(''),
  scaleSignal: z.string().max(500).default(''),
  mailable: z.boolean().default(false),
  contactRef: z.string().max(500).default(''),
})
export type UpsertCompanyInput = z.infer<typeof UpsertCompanyInput>

export const RecordProblemInput = z.object({
  companyId: z.string().min(1),
  problem: z.string().min(1).max(2000),
  mechanism: z.string().max(2000).default(''),
  costEvidence: z.string().max(2000).default(''),
  sourceUrl: z.string().max(1000).default(''),
  headroom: z.string().max(1000).default(''),
  status: ProblemStatus.default('candidate'),
})
export type RecordProblemInput = z.infer<typeof RecordProblemInput>

export interface LedgerCompany {
  id: string
  domain: string
  name: string
  sector: string
  qualification: LedgerQualification
  qualificationReason: string
  scaleSignal: string
  mailable: boolean
  contactRef: string
  problemCount: number
}

interface LedgerCompanyRow {
  id: string
  domain: string
  name: string
  sector: string
  qualification: string
  qualification_reason: string
  scale_signal: string
  mailable: boolean
  contact_ref: string
  problem_count: number
}

function toCompany(row: LedgerCompanyRow): LedgerCompany {
  const qualification = LedgerQualification.safeParse(row.qualification)
  if (!qualification.success) throw new DbContractError(`bad ledger qualification: ${row.qualification}`)
  return {
    id: String(row.id),
    domain: String(row.domain),
    name: String(row.name),
    sector: String(row.sector),
    qualification: qualification.data,
    qualificationReason: String(row.qualification_reason),
    scaleSignal: String(row.scale_signal),
    mailable: row.mailable === true,
    contactRef: String(row.contact_ref),
    problemCount: Number(row.problem_count),
  }
}

const COMPANY_COLUMNS = `c.id AS id, c.domain AS domain, c.name AS name, c.sector AS sector,
  c.qualification AS qualification, c.qualification_reason AS qualification_reason,
  c.scale_signal AS scale_signal, c.mailable AS mailable, c.contact_ref AS contact_ref,
  (SELECT COUNT(*) FROM ledger_problems p WHERE p.company_id = c.id) AS problem_count`

/** Idempotent upsert on domain: sector runs re-report the same company. */
export async function upsertLedgerCompany(db: Db, input: z.input<typeof UpsertCompanyInput>): Promise<LedgerCompany> {
  const parsed = UpsertCompanyInput.safeParse(input)
  if (!parsed.success) throw new DbContractError(`invalid ledger company: ${parsed.error.message}`)
  const row = parsed.data
  const { rows } = await db.query<LedgerCompanyRow>(
    `INSERT INTO ledger_companies
       (id, domain, name, sector, qualification, qualification_reason, scale_signal, mailable, contact_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (domain) DO UPDATE SET
       name = EXCLUDED.name, sector = EXCLUDED.sector,
       qualification = EXCLUDED.qualification,
       qualification_reason = EXCLUDED.qualification_reason,
       scale_signal = EXCLUDED.scale_signal, mailable = EXCLUDED.mailable,
       contact_ref = EXCLUDED.contact_ref, updated_at = now(),
       researched_at = CASE WHEN EXCLUDED.qualification <> 'unresearched' THEN now() ELSE ledger_companies.researched_at END
     RETURNING id, domain, name, sector, qualification, qualification_reason,
       scale_signal, mailable, contact_ref, 0 AS problem_count`,
    [randomUUID(), row.domain, row.name, row.sector, row.qualification, row.qualificationReason, row.scaleSignal, row.mailable, row.contactRef],
  )
  const first = rows[0]
  if (!first) throw new DbContractError('ledger upsert returned no row')
  const company = toCompany(first)
  const counted = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM ledger_problems WHERE company_id = $1', [
    company.id,
  ])
  return { ...company, problemCount: Number(counted.rows[0]?.count ?? 0) }
}

export async function getLedgerCompany(db: Db, id: string): Promise<LedgerCompany | undefined> {
  if (typeof id !== 'string' || id.length === 0) throw new DbContractError('id must be a non-empty string')
  const { rows } = await db.query<LedgerCompanyRow>(
    `SELECT ${COMPANY_COLUMNS} FROM ledger_companies c WHERE c.id = $1`,
    [id],
  )
  const first = rows[0]
  return first ? toCompany(first) : undefined
}

export async function listLedgerCompanies(
  db: Db,
  filter: { qualification?: LedgerQualification; sector?: string; query?: string } = {},
): Promise<LedgerCompany[]> {
  const clauses: string[] = []
  const params: unknown[] = []
  if (filter.qualification !== undefined) {
    const parsed = LedgerQualification.safeParse(filter.qualification)
    if (!parsed.success) throw new DbContractError('invalid qualification filter')
    params.push(parsed.data)
    clauses.push(`c.qualification = $${params.length}`)
  }
  if (filter.sector !== undefined && filter.sector.length > 0) {
    params.push(filter.sector)
    clauses.push(`c.sector = $${params.length}`)
  }
  if (filter.query !== undefined && filter.query.length > 0) {
    params.push(`%${filter.query.slice(0, 200)}%`)
    clauses.push(`(c.name ILIKE $${params.length} OR c.domain ILIKE $${params.length})`)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const { rows } = await db.query<LedgerCompanyRow>(
    `SELECT ${COMPANY_COLUMNS} FROM ledger_companies c ${where} ORDER BY c.updated_at DESC LIMIT 100`,
    params,
  )
  return rows.map(toCompany)
}

export interface LedgerProblem {
  id: string
  companyId: string
  problem: string
  mechanism: string
  costEvidence: string
  sourceUrl: string
  headroom: string
  status: ProblemStatus
}

interface LedgerProblemRow {
  id: string
  company_id: string
  problem: string
  mechanism: string
  cost_evidence: string
  source_url: string
  headroom: string
  status: string
}

function toProblem(row: LedgerProblemRow): LedgerProblem {
  const status = ProblemStatus.safeParse(row.status)
  if (!status.success) throw new DbContractError(`bad problem status: ${row.status}`)
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    problem: String(row.problem),
    mechanism: String(row.mechanism),
    costEvidence: String(row.cost_evidence),
    sourceUrl: String(row.source_url),
    headroom: String(row.headroom),
    status: status.data,
  }
}

/** Appends one researched problem; breadth is structural — call once per
 * problem found, never once per company. */
export async function recordLedgerProblem(db: Db, input: z.input<typeof RecordProblemInput>): Promise<LedgerProblem> {
  const parsed = RecordProblemInput.safeParse(input)
  if (!parsed.success) throw new DbContractError(`invalid ledger problem: ${parsed.error.message}`)
  const row = parsed.data
  const owner = await db.query<{ id: string }>('SELECT id FROM ledger_companies WHERE id = $1', [row.companyId])
  if (owner.rows.length === 0) throw new DbContractError('unknown company for ledger problem')
  const { rows } = await db.query<LedgerProblemRow>(
    `INSERT INTO ledger_problems
       (id, company_id, problem, mechanism, cost_evidence, source_url, headroom, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, company_id, problem, mechanism, cost_evidence, source_url, headroom, status`,
    [randomUUID(), row.companyId, row.problem, row.mechanism, row.costEvidence, row.sourceUrl, row.headroom, row.status],
  )
  const first = rows[0]
  if (!first) throw new DbContractError('ledger problem insert returned no row')
  return toProblem(first)
}

export async function listLedgerProblems(db: Db, companyId: string): Promise<LedgerProblem[]> {
  if (typeof companyId !== 'string' || companyId.length === 0) throw new DbContractError('companyId must be a non-empty string')
  const { rows } = await db.query<LedgerProblemRow>(
    `SELECT id, company_id, problem, mechanism, cost_evidence, source_url, headroom, status
       FROM ledger_problems WHERE company_id = $1 ORDER BY created_at ASC`,
    [companyId],
  )
  return rows.map(toProblem)
}
