// Matrix fixture factory (P6.3): deterministic count/long-text builders plus a
// state -> serveApi mapper. Seeded (no Math.random); every timestamp derives
// from FIXED_NOW so frozen-clock screenshots are stable across runs.
import type { ApiData, ApiOptions, RouteKey, RouteMode } from './api'
import {
  allSectors,
  companiesBySector,
  extraChats,
  karbotSessions,
  mulberry32,
  repeatTo,
  sectorSessions,
  sessionThreads,
  threadMessages,
  type FixtureAlert,
  type FixtureCompany,
  type FixtureMessage,
  type FixtureRun,
  type FixtureSector,
  type FixtureSession,
  type FixtureThread,
} from './fixtures'
import { alerts, runs } from './fixtures'

export type { FixtureAlert, FixtureCompany, FixtureMessage, FixtureRun, FixtureSector, FixtureSession, FixtureThread }
export { allSectors, companiesBySector, extraChats, karbotSessions, sectorSessions, sessionThreads, threadMessages }

/**
 * Frozen wall-clock time installed by the matrix harness before goto. Sits
 * after every fixtures.ts stamp (BASE 2026-09-02 + 30d window) so relative
 * ages render deterministically instead of going negative.
 */
export const FIXED_NOW = '2026-10-05T12:00:00.000Z'
export const FIXED_DAY = '2026-10-05T08:00:00.000Z'

/** 300-char company/sector name (long-text overflow state). */
export const LONG_NAME_300 = repeatTo('Association of licensed commercial electrical contractors operating across regional Queensland and northern New South Wales ', 300)
/** 5k-char chat message (long-text overflow state). */
export const LONG_MESSAGE_5K = repeatTo('The Parramatta crew comparison covers licensing, crew size, coverage suburbs, review counts and quoted rates. ', 5000)
/** Unbroken URL with a 200-char path segment (overflow state). */
export const UNBROKEN_URL = `https://example.com/licence-register/${'a'.repeat(200)}/coverage?suburb=${'b'.repeat(100)}`

const MATRIX_SECTOR: FixtureSector = {
  id: 'sector-matrix',
  name: 'Matrix Trades',
  topic: 'Electrical services',
  state: 'running',
  companiesFound: 0,
  companiesTotal: 0,
  activity: [],
  activityTotal: 0,
  createdAt: FIXED_DAY,
  updatedAt: FIXED_NOW,
}

export function matrixSector(): FixtureSector {
  return { ...MATRIX_SECTOR }
}

/** Deterministic companies for count states (one/typical/100/1000). */
export function makeCompanies(count: number, seed = 60601): FixtureCompany[] {
  const rand = mulberry32(seed)
  const stages = ['Filter', 'Deep research', 'Problem found', 'Final validation'] as const
  const states: FixtureCompany['state'][] = ['running', 'running', 'complete', 'paused', 'queued']
  return Array.from({ length: count }, (_, i) => ({
    id: `mx-company-${String(i + 1).padStart(4, '0')}`,
    sectorId: MATRIX_SECTOR.id,
    sectorName: MATRIX_SECTOR.name,
    name: `Matrix ${['Spark', 'Volt', 'Flow', 'Pipe', 'Sun', 'Air'][i % 6]} ${['Electrical', 'Plumbing', 'HVAC'][i % 3]} ${i + 1}`,
    stage: stages[Math.floor(rand() * stages.length)] as string,
    state: states[Math.floor(rand() * states.length)] as FixtureCompany['state'],
  }))
}

/** Long-text company row: 300-char name plus an unbroken source URL. */
export function longTextCompanies(): FixtureCompany[] {
  return [{
    id: 'mx-company-long',
    sectorId: MATRIX_SECTOR.id,
    sectorName: MATRIX_SECTOR.name,
    name: LONG_NAME_300,
    stage: 'Filter',
    state: 'running',
  }]
}

/** Deterministic chat messages for count states. */
export function makeMessages(count: number): FixtureMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    kind: 'text' as const,
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: i % 2 === 0 ? `Matrix question ${i + 1}: which crews cover commercial work?` : `Matrix answer ${i + 1}: Bright Spark covers commercial work across Parramatta and Ryde.`,
    at: FIXED_NOW,
  }))
}

/** Deterministic sessions for count states. */
export function makeSessions(count: number): FixtureSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `mx-session-${String(i + 1).padStart(3, '0')}`,
    title: `Matrix chat ${i + 1}`,
    createdAt: FIXED_DAY,
    updatedAt: FIXED_NOW,
    sectorId: MATRIX_SECTOR.id,
    kind: 'normal' as const,
  }))
}

/** Deterministic subagent threads for count states. */
export function makeSubagents(sessionId: string, count: number): FixtureThread[] {
  const base = sessionThreads(sessionId, 0)
  const statuses = ['RUNNING', 'RUNNING', 'QUEUED', 'STOPPED']
  for (let i = 0; i < count; i++) {
    base.push({
      key: `agent:${sessionId}-mx-${i + 1}`,
      sessionId,
      name: `Matrix agent ${i + 1}`,
      kind: 'subagent',
      status: statuses[i % statuses.length] as string,
      acceptingSteer: i < 2,
      queueDepth: 0,
      updatedAt: FIXED_NOW,
    })
  }
  return base
}

/** Deterministic runs for count states. */
export function makeRuns(count: number): FixtureRun[] {
  const states: FixtureRun['state'][] = ['RUNNING', 'PAUSED', 'FINISHED', 'ERROR', 'IDLE']
  return Array.from({ length: count }, (_, i) => ({
    id: `mx-run-${String(i + 1).padStart(3, '0')}-9f3c1a2b`,
    sessionId: 'mx-session-001',
    threadKey: 'mx-session-001',
    state: states[i % states.length] as FixtureRun['state'],
    budgetUsedRatio: 0.1 + (i % 9) / 10,
    contextUsedRatio: 0.05 + (i % 7) / 10,
    updatedAt: FIXED_NOW,
  }))
}

export type MatrixDataState =
  | 'loading' | 'empty' | 'one' | 'typical' | 'n100' | 'n1000'
  | 'error' | 'denied' | 'offline' | 'partial' | 'longtext'

const COUNT_ROWS: Record<string, number> = { one: 1, typical: 8, n100: 100, n1000: 1000 }

/**
 * Map a matrix data state to serveApi options for one component. `primary`
 * is the component's data route (faulted for error/denied/offline);
 * `secondary` is an auxiliary route faulted for the partial state.
 */
export function matrixApiOptions(
  state: MatrixDataState,
  primary: RouteKey,
  secondary?: RouteKey,
): ApiOptions {
  const modes: Partial<Record<RouteKey, RouteMode>> = {}
  const data: ApiData = {
    sectors: [matrixSector()],
    companies: makeCompanies(8),
    sessions: makeSessions(3),
    runs: runs.slice(0, 8),
    alerts: alerts.slice(0, 8),
  }
  switch (state) {
    case 'loading':
      modes[primary] = 'loading'
      return { modes, data, loadingMs: 60_000 }
    case 'empty':
      modes[primary] = 'empty'
      return { modes, data }
    case 'one':
    case 'typical':
    case 'n100':
    case 'n1000': {
      const count = COUNT_ROWS[state] as number
      data.companies = makeCompanies(count)
      data.sessions = makeSessions(Math.min(count, 50))
      data.runs = makeRuns(Math.min(count, 50))
      data.subagents = Math.min(count, 50)
      // Typical keeps the showcase thread (tools + reasoning + markdown);
      // only the scaled counts override messages.
      if (state !== 'typical') data.messages = makeMessages(count)
      return { modes, data }
    }
    case 'error':
      modes[primary] = 'error'
      return { modes, data }
    case 'denied':
      modes[primary] = 'denied'
      return { modes, data }
    case 'offline':
      modes[primary] = 'offline'
      return { modes, data }
    case 'partial':
      if (secondary) modes[secondary] = 'error'
      return { modes, data }
    case 'longtext':
      data.companies = longTextCompanies()
      data.messages = [{ seq: 1, kind: 'text', role: 'assistant', text: LONG_MESSAGE_5K, at: FIXED_NOW }]
      data.sectors = [{ ...matrixSector(), name: LONG_NAME_300 }]
      return { modes, data }
  }
}
