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
/** Wide markdown table (longtext table-rendering + 390px scroll state). */
export const LONG_TABLE_MD = `| Company | Crew | Coverage | Reviews | Rate | Notes |\n| --- | --- | --- | --- | --- | --- |\n| Bright Spark Electrical Pty Ltd | 14 | Parramatta, Ryde | 4.8 (212) | Quoted | Licensed, insured |\n| Harbour City Plumbing Services | 9 | Sydney metro | 4.6 (98) | Fixed | After-hours callouts |`

const MATRIX_SECTOR: FixtureSector = {
  id: 'sector-matrix',
  name: 'Matrix Trades',
  topic: 'Electrical services',
  state: 'running',
  // Consistent with the baseline makeCompanies(8): all matrix companies
  // belong to this sector, so the Dashboard caption reads Across 1 sector.
  companiesFound: 8,
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

/** Stable substrings proving long-text fixtures reached the UI. */
export interface MatrixTextExpect {
  text: string
  exact: boolean
}
const NAME_SNIPPET = LONG_NAME_300.slice(0, 80)
const MESSAGE_SNIPPET = LONG_MESSAGE_5K.slice(0, 80)
const URL_SNIPPET = UNBROKEN_URL.slice(0, 60)

/** Snippets per primary for the longtext state. sessions covers
 * SectorWorkspace: the open thread renders the 5k message + URL. */
export function longtextSnippets(primary: string): MatrixTextExpect[] {
  switch (primary) {
    case 'companies':
    case 'sectors':
    case 'sector':
      return [{ text: NAME_SNIPPET, exact: false }]
    case 'messages':
    case 'sessions':
      return [
        { text: MESSAGE_SNIPPET, exact: false },
        { text: URL_SNIPPET, exact: false },
      ]
    default:
      return []
  }
}

/** Deterministic chat messages for count states. */
export function makeMessages(count: number): FixtureMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    kind: 'text' as const,
    role: i % 2 === 0 ? 'user' : 'agent',
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

/** Deterministic sectors for count states (one/typical/100/1000). Keeps
 * sector-matrix first: matrix routes address it for detail + sessions. */
export function makeSectors(count: number): FixtureSector[] {
  const states: FixtureSector['state'][] = ['running', 'complete', 'paused', 'planned', 'approved', 'draft']
  const topics = ['Electrical services', 'Plumbing services', 'HVAC services']
  return Array.from({ length: count }, (_, i) => {
    // Item 0 owns all makeCompanies(count): its count tracks the state.
    if (i === 0) return { ...matrixSector(), companiesFound: count }
    return {
      id: `mx-sector-${String(i + 1).padStart(3, '0')}`,
      name: `Matrix sector ${i + 1}`,
      topic: topics[i % topics.length] as string,
      state: states[i % states.length] as FixtureSector['state'],
      companiesFound: 0,
      createdAt: FIXED_DAY,
      updatedAt: new Date(new Date(FIXED_NOW).getTime() - i * 3_600_000).toISOString(),
    }
  })
}

/** Deterministic Karbot (unscoped) sessions for count states. No sectorId:
 * the sessions endpoint only returns these to unfiltered (Karbot) views. */
export function makeKarbotSessions(count: number): FixtureSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `mx-karbot-${String(i + 1).padStart(3, '0')}`,
    title: `Matrix karbot chat ${i + 1}`,
    createdAt: FIXED_DAY,
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
  sectorState?: FixtureSector['state'],
  localVariant?: 'full' | 'empty' | 'blocked' | 'pending',
): ApiOptions {
  const modes: Partial<Record<RouteKey, RouteMode>> = {}
  const data: ApiData = {
    sectors: [matrixSector()],
    companies: makeCompanies(8),
    sessions: makeSessions(3),
    runs: runs.slice(0, 8),
    // Current warnings (seq 21-24) plus history: the alerts list cases
    // assert the populated list, not the All-clear empty state.
    alerts: [...alerts.slice(0, 4), ...alerts.slice(20, 24)],
    ...(localVariant ? { localVariant } : {}),
  }
  // Cases for state-gated UI (the plan editor needs an editable sector)
  // override the matrix sector state; item 0 is always the matrix sector.
  const applySectorState = () => {
    if (sectorState && data.sectors[0]) data.sectors[0] = { ...data.sectors[0], state: sectorState }
  }
  switch (state) {
    case 'loading':
      modes[primary] = 'loading'
      applySectorState()
      return { modes, data, loadingMs: 60_000 }
    case 'empty':
      modes[primary] = 'empty'
      // The live stream primes data.messages (or the showcase thread
      // when unset) for every state; an empty conversation needs an
      // empty prime too, or the dock shows messages in empty states.
      if (primary === 'messages') data.messages = []
      applySectorState()
      return { modes, data }
    case 'one':
    case 'typical':
    case 'n100':
    case 'n1000': {
      const count = COUNT_ROWS[state] as number
      data.companies = makeCompanies(count)
      data.sessions = makeSessions(count)
      data.runs = makeRuns(Math.min(count, 50))
      data.subagents = count
      data.sectors = makeSectors(count)
      data.karbotSessions = makeKarbotSessions(count)
      // Typical keeps the showcase thread (tools + reasoning + markdown);
      // only the scaled counts override messages.
      if (state !== 'typical') data.messages = makeMessages(count)
      applySectorState()
      return { modes, data }
    }
    case 'error':
      modes[primary] = 'error'
      applySectorState()
      return { modes, data }
    case 'denied':
      modes[primary] = 'denied'
      applySectorState()
      return { modes, data }
    case 'offline':
      modes[primary] = 'offline'
      applySectorState()
      return { modes, data }
    case 'partial':
      if (secondary) modes[secondary] = 'error'
      applySectorState()
      return { modes, data }
    case 'longtext':
      data.companies = longTextCompanies()
      data.messages = [
        { seq: 1, kind: 'text', role: 'agent', text: LONG_MESSAGE_5K, at: FIXED_NOW },
        { seq: 2, kind: 'text', role: 'user', text: UNBROKEN_URL, at: FIXED_NOW },
        // Wide markdown table: the Markdown case asserts table rendering
        // in longtext, and tables exercise the scroll wrapper at 390px.
        { seq: 3, kind: 'text', role: 'agent', text: LONG_TABLE_MD, at: FIXED_NOW },
      ]
      data.sectors = [{ ...matrixSector(), name: LONG_NAME_300, companiesFound: 1 }]
      applySectorState()
      return { modes, data }
  }
}
