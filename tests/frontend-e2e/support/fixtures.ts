// Shared v2 e2e fixtures: ONE realistic dataset for every v2 spec.
// Invented but realistic names; never TEST, never Journey. Deterministic:
// the same seed always builds the same rows, so goldens stay stable.

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Repeat a sentence until it reaches exactly `length` chars (stress text). */
export function repeatTo(text: string, length: number): string {
  let out = text
  while (out.length < length) out += ` ${text}`
  return out.slice(0, length)
}

const DAY = 86_400_000
const BASE = Date.UTC(2026, 8, 2, 9, 0, 0)
const at = (ms: number): string => new Date(ms).toISOString()
const daysAgo = (days: number, hours = 0): string => at(BASE + 30 * DAY - days * DAY - hours * 3_600_000)

export const HEX64 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
export const UUID1 = '0192a3f4-5b6c-7d8e-9f01-23456789abcd'

// ---------------------------------------------------------------- sectors

export type ResearchState =
  | 'draft' | 'planning' | 'planned' | 'approved' | 'running'
  | 'paused' | 'queued' | 'failed' | 'complete'

export interface FixtureSector {
  id: string
  name: string
  topic: string
  companiesFound: number
  state: ResearchState
  researchSessionId?: string | null
  createdAt: string
  updatedAt: string
}

export const sectors: FixtureSector[] = [
  { id: 'sector-electrical', name: 'Australian electrical contractors', topic: 'Licensed electrical contractors serving metro Sydney', companiesFound: 412, state: 'running', researchSessionId: 'session-electrical-research', createdAt: daysAgo(28), updatedAt: daysAgo(0, 2) },
  { id: 'sector-plumbing', name: 'Sydney plumbing services', topic: 'Residential and commercial plumbers across Sydney', companiesFound: 0, state: 'planned', researchSessionId: 'session-plumbing-research', createdAt: daysAgo(21), updatedAt: daysAgo(1, 5) },
  { id: 'sector-hvac', name: 'Melbourne HVAC installers', topic: 'Heating and cooling installers in greater Melbourne', companiesFound: 0, state: 'approved', researchSessionId: 'session-hvac-research', createdAt: daysAgo(18), updatedAt: daysAgo(0, 9) },
  { id: 'sector-solar', name: 'Brisbane solar installers', topic: 'Rooftop solar installers in South East Queensland', companiesFound: 96, state: 'paused', researchSessionId: 'session-solar-research', createdAt: daysAgo(15), updatedAt: daysAgo(3, 1) },
  { id: 'sector-skincare', name: 'D2C skincare brands', topic: 'Direct-to-consumer skincare brands selling online in Australia', companiesFound: 1240, state: 'complete', researchSessionId: 'session-skincare-research', createdAt: daysAgo(30), updatedAt: daysAgo(6) },
  { id: 'sector-foods', name: 'Speciality foods', topic: 'Independent speciality food producers and providores', companiesFound: 0, state: 'draft', researchSessionId: null, createdAt: daysAgo(2), updatedAt: daysAgo(0, 1) },
  { id: 'sector-cleaning', name: 'Perth commercial cleaning', topic: 'Contract cleaners for offices and retail in Perth', companiesFound: 12, state: 'failed', researchSessionId: 'session-cleaning-research', createdAt: daysAgo(12), updatedAt: daysAgo(4, 7) },
  { id: 'sector-roofing', name: 'Adelaide roofing', topic: 'Roof restoration and replacement across Adelaide', companiesFound: 237, state: 'planning', researchSessionId: 'session-roofing-research', createdAt: daysAgo(9), updatedAt: daysAgo(0, 4) },
  { id: 'sector-landscaping', name: 'Hobart landscaping studios', topic: 'Landscape design and construction studios in Hobart', companiesFound: 0, state: 'queued', researchSessionId: null, createdAt: daysAgo(1), updatedAt: daysAgo(0, 6) },
]

export const LONG_NAME = repeatTo('Association of licensed commercial electrical contractors operating across regional Queensland', 120)

export const longSector: FixtureSector = {
  id: 'sector-long', name: LONG_NAME, topic: repeatTo('A sector whose name and topic are long enough to stress truncation in every row, header and breadcrumb', 120),
  companiesFound: 3, state: 'running', researchSessionId: 'session-long-research', createdAt: daysAgo(7), updatedAt: daysAgo(0, 3),
}

export const allSectors: FixtureSector[] = [...sectors, longSector]

export function sectorById(id: string): FixtureSector | undefined {
  return allSectors.find((sector) => sector.id === id)
}

// --------------------------------------------------------------- companies

export interface FixtureCompany {
  id: string
  sectorId: string
  sectorName: string
  name: string
  stage: string
  state: ResearchState
}

export const STAGES = ['Filter', 'Deep research', 'Problem found', 'Final validation'] as const

const NAME_A = ['Bright', 'Harbour', 'Rapid', 'Apex', 'Coral', 'Golden', 'Swift', 'Prime', 'Coastal', 'Urban', 'Elite', 'True', 'Metro', 'Pacific', 'Southern', 'Outback', 'River', 'Bay', 'Crown', 'Opal', 'Wattle', 'Acacia', 'Banksia', 'Waratah', 'Jacaranda', 'Ironbark', 'Grevillea', 'Lillypilly', 'Bottlebrush', 'Paperbark']
const TRADE_B = ['Spark', 'Volt', 'Current', 'Flow', 'Pipe', 'Wrench', 'Sun', 'Ray', 'Panel', 'Air', 'Chill', 'Frost', 'Vent', 'Shine', 'Sweep', 'Scrub', 'Tile', 'Slate', 'Ridge', 'Turf', 'Leaf', 'Lawn', 'Hedge', 'Coat', 'Hue', 'Brush', 'Beam', 'Stud', 'Shield', 'Guard']
const TRADE_C = ['Electrical', 'Electricians', 'Plumbing', 'Plumbers', 'Solar', 'Air Conditioning', 'HVAC', 'Cleaning', 'Roofing', 'Roofers', 'Landscaping', 'Painters', 'Builders', 'Pest Control']
const SUFFIX = ['Pty Ltd', 'Services', 'Group', 'Co', 'Solutions', 'Contractors', 'Specialists', '& Sons', 'Bros', 'Projects']
const SUBURBS = ['Parramatta', 'Chatswood', 'Bondi', 'Manly', 'Cronulla', 'Penrith', 'Hornsby', 'Liverpool', 'Newtown', 'Surry Hills', 'Mosman', 'Dee Why', 'Bankstown', 'Hurstville', 'Epping', 'Ryde', 'Marrickville', 'Leichhardt', 'Randwick', 'Coogee', 'Glebe', 'Balmain', 'Ashfield', 'Strathfield', 'Blacktown', 'Castle Hill', 'Mona Vale', 'Narrabeen', 'Freshwater', 'Curl Curl', 'Katoomba', 'Richmond', 'Windsor', 'Camden', 'Picton', 'Nowra', 'Wollongong', 'Newcastle', 'Gosford', 'Wyong']
const BRAND_A = ['Botanica', 'Glow', 'Velvet', 'Pure', 'Lumen', 'Ember', 'Fern', 'Dune', 'Reef', 'Salt', 'Stone', 'Wattle', 'Quandong', 'Kakadu', 'Banksia', 'Waratah']
const BRAND_B = ['Skin', 'Skin Co', 'Beauty', 'Botanicals', 'Lab', 'Supply', 'Club', 'Studio']
const BRAND_C = ['Australia', 'Co', 'Supply Co', 'Labs', 'Collective', 'House', 'Project', 'Standard', 'Works', 'Union']

function pick<T>(rand: () => number, rows: readonly T[]): T {
  return rows[Math.floor(rand() * rows.length)] as T
}

function tradeName(rand: () => number): string {
  const shape = rand()
  if (shape < 0.35) return `${pick(rand, NAME_A)} ${pick(rand, TRADE_C)} ${pick(rand, SUFFIX)}`
  if (shape < 0.6) return `${pick(rand, NAME_A)} ${pick(rand, TRADE_B)} ${pick(rand, SUFFIX)}`
  if (shape < 0.8) return `${pick(rand, SUBURBS)} ${pick(rand, TRADE_C)}`
  return `${pick(rand, NAME_A)} ${pick(rand, TRADE_B)} ${pick(rand, TRADE_C)}`
}

function brandName(rand: () => number): string {
  return `${pick(rand, BRAND_A)} ${pick(rand, BRAND_B)} ${pick(rand, BRAND_C)}`
}

function companyState(rand: () => number, fallback: ResearchState | null): ResearchState {
  if (fallback) return fallback
  const roll = rand()
  if (roll < 0.55) return 'running'
  if (roll < 0.75) return 'complete'
  if (roll < 0.85) return 'paused'
  if (roll < 0.92) return 'queued'
  if (roll < 0.97) return 'failed'
  return 'draft'
}

function buildCompanies(): FixtureCompany[] {
  const rand = mulberry32(20261003)
  const seen = new Set<string>()
  const rows: FixtureCompany[] = []
  let index = 0
  const counts: Record<string, number> = {}
  for (const sector of allSectors) {
    const total = sector.id === 'sector-long' ? 3 : sector.companiesFound
    for (let i = 0; i < total; i++) {
      const fixed = sector.state === 'complete' || sector.state === 'failed' || sector.state === 'paused' ? sector.state : null
      let name = sector.id === 'sector-skincare' ? brandName(rand) : tradeName(rand)
      if (seen.has(name)) name = `${name} ${++index}`
      seen.add(name)
      rows.push({
        id: `company-${String(rows.length + 1).padStart(4, '0')}`,
        sectorId: sector.id,
        sectorName: sector.name,
        name,
        stage: STAGES[Math.floor(rand() * STAGES.length)] as string,
        state: companyState(rand, fixed),
      })
      counts[sector.id] = (counts[sector.id] ?? 0) + 1
    }
  }
  return rows
}

export const companies: FixtureCompany[] = buildCompanies()

export function companiesBySector(sectorId: string): FixtureCompany[] {
  return companies.filter((company) => company.sectorId === sectorId)
}

// ---------------------------------------------------------------- sessions

export interface FixtureSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  sectorId?: string
  kind?: 'research' | 'normal'
  model?: { provider: 'meta'; model: string; reasoning: boolean; effort?: string }
}

const CHAT_TITLES = [
  'Brainstorm search directions',
  'Compare the Parramatta installers',
  'Which companies need review first',
  'Draft questions for the sparkies',
  'Coverage gaps in the west',
]

export function sectorSessions(sector: FixtureSector): FixtureSession[] {
  const researchId = sector.researchSessionId ?? `session-${sector.id}-research`
  const rows: FixtureSession[] = [{
    id: researchId, title: 'Research', kind: 'research', sectorId: sector.id,
    createdAt: sector.createdAt, updatedAt: sector.updatedAt,
  }]
  CHAT_TITLES.forEach((title, i) => {
    rows.push({
      id: `session-${sector.id}-chat-${i + 1}`, title, kind: 'normal', sectorId: sector.id,
      createdAt: daysAgo(6 - i), updatedAt: daysAgo(Math.max(0, 2 - i), i),
    })
  })
  rows.push({
    id: `session-${sector.id}-chat-long`, title: repeatTo('Follow up on the western Sydney commercial contractors shortlist before Friday', 120),
    kind: 'normal', sectorId: sector.id, createdAt: daysAgo(1), updatedAt: daysAgo(0, 1),
  })
  return rows
}

function buildKarbotSessions(): FixtureSession[] {
  const titles = ['Browser chat', 'What is running right now', 'Create a new sector', 'Show recent companies', 'Help me triage alerts', 'Plan the week']
  return Array.from({ length: 60 }, (_, i) => ({
    id: `session-karbot-${String(i + 1).padStart(2, '0')}`,
    title: i < titles.length ? (titles[i] as string) : `Karbot conversation ${i + 1}`,
    createdAt: daysAgo(29 - Math.floor(i / 2)),
    updatedAt: daysAgo(Math.floor(i / 4), i % 5),
    ...(i === 0 ? { model: { provider: 'meta' as const, model: 'muse-spark-1.3-contributor', reasoning: true, effort: 'high' } } : {}),
  }))
}

export const karbotSessions: FixtureSession[] = buildKarbotSessions()

/** Extra deterministic chats for one sector (WS-04-many paging shots). */
export function extraChats(sectorId: string, count: number): FixtureSession[] {
  const topics = ['shortlist review', 'coverage check', 'crew comparison', 'quote follow-up', 'licence check', 'reference call']
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${sectorId}-chat-extra-${i + 1}`,
    title: `${topics[i % topics.length] as string} ${Math.floor(i / topics.length) + 1}`,
    kind: 'normal' as const,
    sectorId,
    createdAt: daysAgo(20 - (i % 20)),
    updatedAt: daysAgo(i % 9, i % 7),
  }))
}

export function sessionById(id: string): FixtureSession | undefined {
  for (const sector of allSectors) {
    const found = sectorSessions(sector).find((session) => session.id === id)
    if (found) return found
  }
  return karbotSessions.find((session) => session.id === id)
}

// ----------------------------------------------------------------- threads

export interface FixtureThread {
  key: string
  sessionId: string
  name?: string
  kind: string
  status: string
  acceptingSteer: boolean
  queueDepth: number
  updatedAt: string
}

export function sessionThreads(sessionId: string, subagents = 0): FixtureThread[] {
  const rows: FixtureThread[] = [{
    key: sessionId, sessionId, kind: 'session', status: 'RUNNING',
    acceptingSteer: true, queueDepth: 0, updatedAt: daysAgo(0, 1),
  }]
  const statuses = ['RUNNING', 'RUNNING', 'QUEUED', 'STOPPED', 'STOPPED', 'STOPPED']
  for (let i = 0; i < subagents; i++) {
    rows.push({
      key: `agent:${sessionId}-child-${i + 1}`, sessionId, name: `Research agent ${i + 1}`,
      kind: 'subagent', status: statuses[i % statuses.length] as string,
      acceptingSteer: i < 2, queueDepth: i === 2 ? 2 : 0, updatedAt: daysAgo(0, 2 + i),
    })
  }
  return rows
}

// ---------------------------------------------------------------- messages

export interface FixtureMessage {
  seq: number
  kind: 'text' | 'tool'
  role?: string
  text?: string
  reasoning?: string
  failed?: boolean
  missedSteer?: boolean
  at?: string
  name?: string
  detail?: string
  state?: string
}

const SHOWCASE_REPLY = `## Crew comparison

I compared the two Parramatta crews on size, coverage and recent reviews. Both are licensed for commercial work.

### What changed this week

- Bright Spark Electrical added two apprentice crews in Parramatta.
- Harbour City Plumbing now lists after-hours commercial callouts.
- Rapid Volt Group has not updated its coverage page since March.

| Company | Crew | Coverage | Reviews | Rate | Notes |
| --- | --- | --- | --- | --- | --- |
| Bright Spark Electrical Pty Ltd | 14 | Parramatta, Ryde | 4.8 (212) | Quoted | Licensed, insured |
| Harbour City Plumbing | 9 | Sydney metro | 4.6 (98) | Quoted | After-hours cover |

\`\`\`text
site:parramatta commercial electrician licensed crew
\`\`\`

> The coverage pages were last fetched on 30 Sep 2026. Treat the review counts as directional.

Full crew rosters are on the [licence register](https://example.com/licence-register) and the [coverage map](https://example.com/coverage-map).`

const LONG_REASONING = `First I checked the sector context for the Parramatta scope notes, then I searched the knowledge base for the crew-size rubric. The rubric says crew size only counts when a source names the crew count or the roster page lists named electricians.

Next I fetched the two coverage pages and compared the review counts. Bright Spark has more reviews but several mention residential work, so I weighted the commercial mentions only.

Finally I decided the comparison table was worth surfacing because both companies clear the commercial-licence bar and the crew gap is material to the shortlist.`

export function threadMessages(threadKey: string): FixtureMessage[] {
  void threadKey
  const t0 = BASE + 30 * DAY - 2 * 3_600_000
  const stamp = (minutes: number): string => at(t0 + minutes * 60_000)
  const rows: FixtureMessage[] = [
    { seq: 1, kind: 'text', role: 'user', text: 'Find electrical contractors in Parramatta with commercial experience.', at: stamp(0) },
    { seq: 2, kind: 'tool', name: 'db.kb_search', detail: 'searched 4 units', state: 'done', at: stamp(1) },
    { seq: 3, kind: 'tool', name: 'web_search', detail: '6 results', state: 'done', at: stamp(1) },
    { seq: 4, kind: 'tool', name: 'web_fetch', detail: '2 pages', state: 'done', at: stamp(2) },
    { seq: 5, kind: 'text', role: 'agent', text: SHOWCASE_REPLY, reasoning: 'Checked the sector list and compared the two Parramatta crews.', at: stamp(3) },
    { seq: 6, kind: 'text', role: 'user', text: 'What about @site-audit-2026.pdf? Did you check the audit notes?', at: stamp(9) },
    { seq: 7, kind: 'text', role: 'agent', text: 'I read the audit notes. They confirm the licence numbers but add no new companies.', reasoning: LONG_REASONING, at: stamp(11) },
    { seq: 8, kind: 'text', role: 'user', text: 'Compare the top two by crew size.', at: stamp(14) },
    { seq: 9, kind: 'tool', name: 'web_fetch', detail: 'coverage page', state: 'failed', at: stamp(15) },
    { seq: 10, kind: 'tool', name: 'web_fetch', detail: 'roster page', state: 'done', at: stamp(16) },
    { seq: 11, kind: 'text', role: 'agent', text: 'Bright Spark runs the larger crew (14 named electricians) against Harbour City (9). The failed fetch was the coverage page, so I used the roster page instead.', at: stamp(17) },
  ]
  let seq = 12
  for (let round = 0; round < 7 && seq <= 38; round++) {
    rows.push({ seq: seq++, kind: 'text', role: 'user', text: `Follow-up question ${round + 1} about the shortlist.`, at: stamp(20 + round * 6) })
    rows.push({ seq: seq++, kind: 'tool', name: 'db.kb_search', detail: 'searched 2 units', state: 'done', at: stamp(21 + round * 6) })
    rows.push({ seq: seq++, kind: 'text', role: 'agent', text: `Short answer ${round + 1}: the shortlist still holds.`, reasoning: round % 2 === 0 ? `Reasoned about follow-up ${round + 1}.` : undefined, at: stamp(22 + round * 6) })
  }
  rows.push({ seq: seq++, kind: 'text', role: 'user', text: 'Hold on, check the Ryde crews too before you finish.', missedSteer: true, at: stamp(70) })
  while (seq <= 40) {
    rows.push({ seq: seq++, kind: 'text', role: 'agent', text: 'Noted. I will fold the Ryde crews into the next pass.', at: stamp(70 + seq) })
  }
  return rows
}

// -------------------------------------------------------------------- plans

export interface FixtureExecutablePlan {
  researchDepth: 'discovery'
  discoveryTarget: number
  discovery: Array<{ id: string; title: string; queries: string[]; maxPages: number }>
  companyBrief: string
  budgets: { maxCompanies: number; maxWallMinutes: number; concurrency: 2 }
  acceptance: string[]
}

export interface FixturePlanVersion {
  version: number
  markdown: string
  at: string
  executable?: FixtureExecutablePlan
}

function buildExecutablePlan(): FixtureExecutablePlan {
  const titles = [
    'Licensed commercial electricians in Parramatta',
    'After-hours commercial callout crews',
    'Industrial switchboard specialists',
    'Strata and facilities maintenance contractors',
    'Solar and battery accredited installers',
  ]
  const queries = [
    'site:com.au Parramatta commercial electrician licensed',
    '"commercial electrician" Parramatta crew',
    'Parramatta industrial electrician switchboard upgrade',
    'strata electrician Sydney maintenance contract',
    'after hours electrician Sydney commercial callout',
    'Level 2 electrician Parramatta ASP',
  ]
  return {
    researchDepth: 'discovery',
    discoveryTarget: 200,
    discovery: titles.map((title, i) => ({
      id: `direction-${i + 1}`,
      title,
      queries: queries.slice(i, i + 3 + (i % 3)).map((query, j) => (i === 2 && j === 1 ? repeatTo('Licensed switchboard specialist contractor serving Parramatta commercial sites', 300) : query)),
      maxPages: 5,
    })),
    companyBrief: repeatTo('Record licensed commercial electrical contractors with named crews, coverage pages and review counts. Skip directories, news articles and DIY guides.', 900),
    budgets: { maxCompanies: 500, maxWallMinutes: 1440, concurrency: 2 },
    acceptance: [
      'Every company links to a fetched source on its own domain.',
      'Crew size is recorded only from named rosters or crew counts.',
      'Directories, news and guides are excluded with reasons.',
      'Coverage pages are dated within the last year.',
      'Counter-evidence is recorded before qualification.',
      'The ledger holds at most 500 companies for this sector.',
    ],
  }
}

export const executablePlan = buildExecutablePlan()

export const narrativeMarkdown = `## scope
Electrical.
## direction shards
Sydney.
## query shapes
Uncertain.
## budgets
Uncertain.
## risks
None.
## open questions
Coverage?`

export const newFormatMarkdown = `## Goal
Map the licensed commercial electrical contractors serving Parramatta so the ledger holds comparable, sourced companies.
## Search directions
### Licensed commercial crews
Target licensed crews with named electricians and commercial coverage pages.
### After-hours callout cover
Target crews advertising after-hours commercial callouts in Sydney metro.
## Steps
1. Search each direction with the listed queries.
2. Fetch coverage and roster pages for every candidate.
3. Record crew size only from named sources.
4. Exclude directories, news and guides with reasons.
## Budget and limits
At most 500 companies and 24 hours of active research time.
## Risks
Coverage pages may be stale; review counts are directional.
## Open questions
Whether Ryde crews belong in this sector or a new one.`

export const planVersions: FixturePlanVersion[] = [
  { version: 1, markdown: narrativeMarkdown, at: daysAgo(10) },
  { version: 2, markdown: narrativeMarkdown, at: daysAgo(8) },
  { version: 3, markdown: newFormatMarkdown, at: daysAgo(5), executable: executablePlan },
]

export interface FixturePlanView {
  sectorId: string
  versions: FixturePlanVersion[]
  latest: FixturePlanVersion | null
  approvals: number[]
  approvedVersion: number | null
}

export function planView(sectorId: string, variant: 'approved' | 'legacy' | 'empty' = 'approved'): FixturePlanView {
  if (variant === 'empty') return { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  if (variant === 'legacy') {
    return { sectorId, versions: planVersions.slice(0, 2), latest: planVersions[1] as FixturePlanVersion, approvals: [], approvedVersion: null }
  }
  return { sectorId, versions: planVersions, latest: planVersions[2] as FixturePlanVersion, approvals: [3], approvedVersion: 3 }
}

// ---------------------------------------------------------------- progress

export interface FixtureWorkItem {
  id: string
  kind: 'discovery' | 'company'
  title: string
  receiptVersion?: string
  state: 'pending' | 'running' | 'complete' | 'blocked' | 'failed' | 'excluded'
  attempts: number
  childId: string | null
  evidence: string[]
  detail: string
  sourceUrl?: string
}

export interface FixtureProgress {
  budgetUsedMs?: number
  sectorId: string
  state: string
  planVersion: number
  plan?: { latest: FixturePlanVersion | null; versions: FixturePlanVersion[]; approvals: number[]; approvedVersion: number | null }
  items: FixtureWorkItem[]
  completed: number
  total: number
  unresolved: number
  discoveryClosed: boolean
  estimatedPercent: number | null
}

function workItems(count: number, seed: number): FixtureWorkItem[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, (_, i) => {
    const roll = i / count
    const state = roll < 0.75 ? 'complete' : roll < 0.875 ? 'running' : roll < 0.95 ? 'blocked' : i % 2 === 0 ? 'failed' : 'excluded'
    return {
      id: `work-${String(i + 1).padStart(3, '0')}`,
      kind: i % 3 === 0 ? 'company' : 'discovery',
      title: `Screen ${pick(rand, SUBURBS)} ${pick(rand, TRADE_C).toLowerCase()} results page ${Math.floor(i / 4) + 1}`,
      ...(state === 'blocked' && i % 4 === 0 ? { receiptVersion: HEX64 } : {}),
      state: state as FixtureWorkItem['state'],
      attempts: state === 'complete' ? 1 : 1 + Math.floor(rand() * 3),
      childId: state === 'running' ? `child-${i}` : null,
      evidence: state === 'complete' ? ['Licensed crew named on the roster page.'] : [],
      detail: state === 'complete' ? 'Accepted after source review.' : state === 'running' ? 'Reviewer is reading the coverage page.' : state === 'blocked' ? 'Waiting on the coverage page fetch.' : state === 'failed' ? 'The source page did not load.' : 'Excluded as a directory page.',
      ...(state !== 'pending' ? { sourceUrl: `https://example.com/contractor-${i + 1}` } : {}),
    }
  })
}

export function progressFor(sectorId: string, variant: 'running' | 'complete' | 'empty' | 'large'): FixtureProgress {
  if (variant === 'empty') {
    return { sectorId, state: 'draft', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  }
  if (variant === 'complete') {
    const items = workItems(40, 77).map((item) => ({ ...item, state: 'complete' as const, detail: 'Accepted after source review.' }))
    return { budgetUsedMs: 11_520_000, sectorId, state: 'complete', planVersion: 3, plan: { latest: planVersions[2] as FixturePlanVersion, versions: planVersions, approvals: [3], approvedVersion: 3 }, items, completed: 40, total: 40, unresolved: 0, discoveryClosed: true, estimatedPercent: 100 }
  }
  if (variant === 'large') {
    const items = workItems(500, 78)
    const completed = items.filter((item) => item.state === 'complete').length
    return { budgetUsedMs: 19_200_000, sectorId, state: 'running', planVersion: 3, items, completed, total: 500, unresolved: 12, discoveryClosed: false, estimatedPercent: 71 }
  }
  const items = workItems(40, 79)
  // The reviewable intake candidate: blocked discovery with a saved
  // receipt, so PL-09/SL-04 can open from the ledger's Review action.
  items[35] = {
    id: 'work-036:intake:parramatta-2',
    kind: 'discovery',
    title: 'Screen Parramatta results page 2',
    receiptVersion: HEX64,
    state: 'blocked',
    attempts: 4,
    childId: 'child-intake-1',
    evidence: ['https://example.com/contractor-7/roster', 'https://example.com/contractor-7/coverage'],
    detail: 'The roster page names three electricians but the coverage page has not loaded yet.',
    sourceUrl: 'https://example.com/contractor-7',
  }
  const completed = items.filter((item) => item.state === 'complete').length
  return { budgetUsedMs: 11_520_000, sectorId, state: 'running', planVersion: 3, plan: { latest: planVersions[2] as FixturePlanVersion, versions: planVersions, approvals: [3], approvedVersion: 3 }, items, completed, total: 40, unresolved: 3, discoveryClosed: false, estimatedPercent: 62 }
}

// ---------------------------------------------------------- global context

export interface FixtureSections { scope: string; decisions: string; findings: string; questions: string }

export interface FixtureChange {
  id: string
  baseVersion: number
  sections: FixtureSections
  sourceThread: string
  author: string
  state: 'pending' | 'parent-review' | 'approved' | 'denied'
  version: number | null
  at: string
  fileRef: { fileId: string; filename: string; hash: string; ords: number[] } | null
  sourceRefs?: Array<{ fileId: string; filename: string; hash: string; ords: number[] }>
}

export interface FixtureGlobal {
  sectorId: string
  version: number
  sections: FixtureSections
  markdown: string
  researchSessionId: string | null
  changes: FixtureChange[]
}

const FULL_SECTIONS: FixtureSections = {
  scope: 'Licensed commercial electrical contractors serving Parramatta and nearby Ryde.\n\n## Coverage\nParramatta first, then Ryde. Residential-only crews are out of scope.\n\nCrew size counts only from named rosters or explicit crew counts.',
  decisions: 'Ryde crews stay in this sector until the owner says otherwise.\n\nDirectories and news pages are excluded with reasons, never silently.',
  findings: 'Bright Spark Electrical runs 14 named electricians across Parramatta and Ryde.\n\nHarbour City Plumbing added after-hours commercial callouts in September.',
  questions: 'Do the western Sydney crews belong here or in a new sector?\n\nIs the licence register current for the Ryde postcodes?',
}

function pendingChange(id: string, withFile: boolean): FixtureChange {
  return {
    id, baseVersion: 2,
    sections: { ...FULL_SECTIONS, findings: `${FULL_SECTIONS.findings}\n\nRapid Volt Group lists 6 named electricians in Parramatta.` },
    sourceThread: 'session-electrical-research', author: 'Research agent 1', state: 'pending', version: null, at: daysAgo(0, 5),
    fileRef: withFile ? { fileId: 'file-md-1', filename: 'parramatta-crew-notes.md', hash: HEX64, ords: [0, 1] } : null,
    ...(withFile ? { sourceRefs: [{ fileId: 'file-md-1', filename: 'parramatta-crew-notes.md', hash: HEX64, ords: [0, 1] }] } : {}),
  }
}

export function globalFor(sectorId: string, variant: 'full' | 'empty' = 'full'): FixtureGlobal {
  if (variant === 'empty') {
    return { sectorId, version: 1, sections: { scope: '', decisions: '', findings: '', questions: '' }, markdown: '', researchSessionId: null, changes: [] }
  }
  const decided: FixtureChange[] = [3, 4, 5, 6, 7].map((n) => ({
    id: `change-${n}`, baseVersion: n - 2,
    sections: FULL_SECTIONS, sourceThread: 'session-electrical-research', author: n % 2 ? 'Owner' : 'Research agent 2',
    state: n % 3 === 0 ? 'denied' : 'approved', version: n - 2, at: daysAgo(n), fileRef: null,
  }))
  return {
    sectorId, version: 3, sections: FULL_SECTIONS,
    markdown: `## Scope\n${FULL_SECTIONS.scope}\n\n## Decisions\n${FULL_SECTIONS.decisions}\n\n## Findings\n${FULL_SECTIONS.findings}\n\n## Open questions\n${FULL_SECTIONS.questions}`,
    researchSessionId: 'session-electrical-research',
    changes: [pendingChange('change-pending-1', true), pendingChange('change-pending-2', false), ...decided],
  }
}

// -------------------------------------------------------------------- files

export interface FixtureFile {
  id: string
  filename: string
  status: string
  source: string
  hash: string
  hidden: boolean
  included: boolean
  kind: 'document' | 'artifact'
  sessionId?: string
  processing?: {
    jobId: string; state: 'queued' | 'processing' | 'paused' | 'failed' | 'uncertain' | 'complete'
    revision: number; totalImages: number | null; completedImages: number; failedImages: number
    uncertainImages: number; errorCode: string | null; retryRequiresApproval: boolean
  }
}

function processing(state: FixtureFile['processing']): FixtureFile['processing'] {
  return state
}

export const libraryFiles: FixtureFile[] = [
  { id: 'file-md-1', filename: 'parramatta-crew-notes.md', status: 'indexed', source: 'upload', hash: HEX64, hidden: false, included: true, kind: 'document' },
  { id: 'file-pdf-1', filename: 'site-audit-2026.pdf', status: 'processing', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document', processing: processing({ jobId: 'job-pdf-1', state: 'processing', revision: 1, totalImages: 9, completedImages: 4, failedImages: 0, uncertainImages: 0, errorCode: null, retryRequiresApproval: false }) },
  { id: 'file-pdf-2', filename: 'ryde-roster-scan.pdf', status: 'failed', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document', processing: processing({ jobId: 'job-pdf-2', state: 'failed', revision: 2, totalImages: 6, completedImages: 2, failedImages: 1, uncertainImages: 0, errorCode: 'OCR_PROVIDER_TIMEOUT', retryRequiresApproval: true }) },
  { id: 'file-pdf-3', filename: 'coverage-map.pdf', status: 'paused', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document', processing: processing({ jobId: 'job-pdf-3', state: 'paused', revision: 1, totalImages: 4, completedImages: 1, failedImages: 0, uncertainImages: 0, errorCode: null, retryRequiresApproval: false }) },
  { id: 'file-csv-1', filename: 'contractor-rates.csv', status: 'indexed', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document' },
  { id: 'file-json-1', filename: 'licence-register.json', status: 'indexed', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document' },
  { id: 'file-docx-1', filename: 'scope-brief.docx', status: 'indexed', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document' },
  { id: 'file-png-1', filename: 'switchboard-photo.png', status: 'needs-ocr', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document' },
  { id: 'file-hidden-1', filename: 'draft-exclusions.md', status: 'indexed', source: 'upload', hash: HEX64, hidden: true, included: false, kind: 'document' },
  { id: `${'x'}.`.length ? 'file-long-1' : 'file-long-1', filename: `${repeatTo('western sydney commercial contractor shortlist working notes', 116)}.md`, status: 'indexed', source: 'upload', hash: HEX64, hidden: false, included: false, kind: 'document' },
  { id: 'file-artifact-1', filename: 'shortlist-report.md', status: 'indexed', source: 'agent', hash: HEX64, hidden: false, included: false, kind: 'artifact', sessionId: 'session-electrical-research' },
]

export function largeLibrary(count = 2005): FixtureFile[] {
  const rand = mulberry32(4242)
  const exts = ['md', 'pdf', 'csv', 'json', 'docx', 'png']
  return Array.from({ length: count }, (_, i) => ({
    id: `file-bulk-${i + 1}`,
    filename: `field-note-${String(i + 1).padStart(4, '0')}.${pick(rand, exts)}`,
    status: 'indexed', source: i % 5 === 0 ? 'agent' : 'upload', hash: HEX64,
    hidden: i % 37 === 0, included: i % 41 === 0, kind: i % 5 === 0 ? 'artifact' : 'document',
  }))
}

export const FILE_MARKDOWN = `## Parramatta crew notes

These notes summarise the September visits to three Parramatta contractors.

### Bright Spark Electrical

- 14 named electricians across two crews.
- Commercial coverage in Parramatta and Ryde.
- Licence numbers verified against the register.

### Harbour City Plumbing

- 9 plumbers with after-hours commercial callouts.
- Coverage page updated in September 2026.

### Rapid Volt Group

- 6 named electricians, Parramatta only.
- Roster page lists apprentice crews separately.`

export function fileUnits(fromOrd: number, total = 84): { status: string; units: Array<{ ord: number; kind: string; text: string; uncertain: boolean; page?: number }>; nextOrd: number | null; fullChars: number } {
  const units = Array.from({ length: Math.min(20, total - fromOrd) }, (_, i) => {
    const ord = fromOrd + i
    return {
      ord, kind: ord % 3 === 0 ? 'image' : 'text',
      text: ord % 3 === 0 ? `Chart description for page ${Math.floor(ord / 3) + 1}: crew counts by suburb.` : `Extracted paragraph ${ord + 1} from the audit document.`,
      uncertain: ord % 3 === 0,
      page: Math.floor(ord / 3) + 1,
    }
  })
  const next = fromOrd + units.length
  return { status: 'indexed', units, nextOrd: next < total ? next : null, fullChars: total * 120 }
}

// --------------------------------------------------------------- local ctx

export interface FixtureLocal {
  threadKey: string
  notes: string
  summary: string
  coveredSeq: number
  version: number
  task?: string
  contextBlocked?: string
  usage?: { inputTokens: number; budget: number; window: number; method: 'exact' | 'estimated' }
  sourceRefs?: Array<{ fileId: string; filename: string; hash: string; ords: number[] }>
  pendingOperations?: Array<{ operationId: string; toolName: string; callId: string; reason: string }>
}

export function localFor(threadKey: string, variant: 'full' | 'empty' | 'blocked' | 'pending' = 'full'): FixtureLocal {
  if (variant === 'empty') return { threadKey, notes: '', summary: '', coveredSeq: 0, version: 1 }
  if (variant === 'blocked') {
    return { threadKey, notes: 'Waiting on the rebuild.', summary: 'Summary of the Parramatta shortlist work.', coveredSeq: 30, version: 2, contextBlocked: 'A file source changed after this summary was written.', usage: { inputTokens: 48210, budget: 100000, window: 200000, method: 'exact' } }
  }
  if (variant === 'pending') {
    return {
      threadKey, notes: '', summary: 'Summary of the Parramatta shortlist work.', coveredSeq: 34, version: 2,
      usage: { inputTokens: 48210, budget: 100000, window: 200000, method: 'exact' },
      pendingOperations: [
        { operationId: `op:${'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890987654321abcdefabcdef12'}`, toolName: 'db.mark_company_found', callId: 'call_7f3a', reason: 'The reply was lost after the tool ran.' },
        { operationId: `op:${'f1e2d3c4b5a69788796a5b4c3d2e1f001234567890987654321abcdefabcdef34'}`, toolName: 'db.set_company_stage', callId: 'call_7f3b', reason: 'The stream dropped before the confirmation.' },
      ],
    }
  }
  return {
    threadKey, notes: 'Ryde crews need a second pass.', summary: 'Summary of the Parramatta shortlist work so far.', coveredSeq: 38, version: 2,
    task: 'Research Parramatta contractors',
    usage: { inputTokens: 48210, budget: 100000, window: 200000, method: 'exact' },
    sourceRefs: [{ fileId: 'file-md-1', filename: 'parramatta-crew-notes.md', hash: HEX64, ords: [0, 1] }],
  }
}

// ------------------------------------------------------------------ alerts

export interface FixtureAlert {
  seq: number
  at: string
  sessionId: string
  sessionTitle: string
  threadKey: string
  sectorId: string | null
  kind: 'closed-owner' | 'missing-heartbeat' | 'stalled-progress' | 'queue-starvation' | 'owner-unavailable'
  response: 'observe' | 'park'
  state: 'current-warning' | 'historical'
  threadStatus: string
}

export const alerts: FixtureAlert[] = (() => {
  const kinds: FixtureAlert['kind'][] = ['stalled-progress', 'missing-heartbeat', 'queue-starvation', 'closed-owner', 'owner-unavailable']
  return Array.from({ length: 24 }, (_, i) => ({
    seq: i + 1,
    at: daysAgo(Math.floor(i / 4), i % 6),
    sessionId: i % 3 === 0 ? `session-karbot-${String((i % 9) + 1).padStart(2, '0')}` : 'session-electrical-research',
    sessionTitle: i % 3 === 0 ? 'Browser chat' : 'Research',
    threadKey: i % 3 === 0 ? `session-karbot-${String((i % 9) + 1).padStart(2, '0')}` : 'session-electrical-research',
    sectorId: i % 3 === 0 ? null : 'sector-electrical',
    kind: kinds[i % kinds.length] as FixtureAlert['kind'],
    response: i % 4 === 0 ? 'park' : 'observe',
    state: i >= 20 ? 'current-warning' : 'historical',
    threadStatus: i >= 20 ? 'RUNNING' : 'FINISHED',
  }))
})()

// -------------------------------------------------------------------- runs

export interface FixtureRun {
  id: string
  sessionId: string
  threadKey: string
  state: 'IDLE' | 'RUNNING' | 'PAUSED' | 'SUSPENDED' | 'CANCELLING' | 'FINISHED' | 'ERROR'
  budgetUsedRatio: number
  contextUsedRatio: number
  updatedAt: string
  stageCursor?: string
}

export const runs: FixtureRun[] = (() => {
  const states: FixtureRun['state'][] = ['RUNNING', 'RUNNING', 'RUNNING', 'PAUSED', 'CANCELLING', 'FINISHED', 'FINISHED', 'FINISHED', 'ERROR', 'IDLE', 'SUSPENDED', 'FINISHED']
  return Array.from({ length: 25 }, (_, i) => ({
    id: `run-${(0x9f3c1a2b + i * 7919).toString(16).slice(0, 8)}-${String(i + 1).padStart(2, '0')}`,
    sessionId: i % 2 ? 'session-electrical-research' : 'session-karbot-01',
    threadKey: i % 2 ? 'session-electrical-research' : 'session-karbot-01',
    state: states[i % states.length] as FixtureRun['state'],
    budgetUsedRatio: 0.1 + (i % 9) / 10,
    contextUsedRatio: 0.05 + (i % 7) / 10,
    updatedAt: daysAgo(Math.floor(i / 6), i % 8),
    ...(i % 3 === 0 ? { stageCursor: `screening batch ${i + 1}` } : {}),
  }))
})()

// --------------------------------------------------------------- providers

export const providers = {
  defaultProvider: 'meta' as const,
  providers: [{
    name: 'meta' as const,
    hasKey: true,
    defaultModel: 'muse-spark-1.3-contributor',
    models: [
      { provider: 'meta' as const, model: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', reasoning: 'native' as const, mode: 'responses' as const, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
      { provider: 'meta' as const, model: 'muse-spark-1.3', displayName: 'Muse Spark 1.3', reasoning: 'native' as const, mode: 'responses' as const, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
      { provider: 'meta' as const, model: 'muse-spark-1.3-compact', displayName: 'Muse Spark 1.3 Compact', reasoning: 'none' as const, mode: 'chat' as const, efforts: [] },
    ],
  }],
}

export const providersNoKey = {
  defaultProvider: 'meta' as const,
  providers: [{ name: 'meta' as const, hasKey: false, defaultModel: 'muse-spark-1.3-contributor', models: providers.providers[0]?.models ?? [] }],
}

export const providersEmpty = { defaultProvider: 'meta' as const, providers: [] }

// ------------------------------------------------------------------ skills

export const skills = [
  { name: 'plan', description: 'Draft a milestone plan for the conversation.', tools: ['plan.create', 'plan.update'] },
  { name: 'research', description: 'Run a bounded evidence sweep.', tools: ['web_search', 'web_fetch'] },
]

// --------------------------------------------------------------- artifacts

export const artifacts = [
  { artifactId: 'art-1', name: 'shortlist.md', kind: 'report', bytes: 2048, sha256: HEX64, detail: 'Parramatta shortlist', indexed: true },
  { artifactId: 'art-2', name: 'crew-table.csv', kind: 'file', bytes: 512, sha256: HEX64, detail: 'Crew table', indexed: true },
  { artifactId: 'art-3', name: 'pending-draft.md', kind: 'file', indexed: false },
]

// ------------------------------------------------------- execution records

export function executionPage(afterSeq: number): { records: unknown[]; nextAfterSeq: number | null } {
  const kinds = ['request', 'response', 'tool-result'] as const
  const records = Array.from({ length: 20 }, (_, i) => {
    const seq = afterSeq + i + 1
    if (seq > 45) return null
    return {
      seq, at: daysAgo(0, 2), runKey: 'run:session-electrical-research', attemptLease: UUID1,
      round: Math.floor(seq / 3) + 1, kind: kinds[seq % 3],
      workflowId: 'session-run-electrical', executionId: 'exec-9f3c1a2b',
      ref: { hash: HEX64, bytes: 1234 + seq },
    }
  }).filter(Boolean)
  const last = afterSeq + records.length
  return { records, nextAfterSeq: last < 45 ? last : null }
}

export function executionBody(seq: number): { record: Record<string, unknown> } {
  return { record: { seq, kind: 'tool-result', round: 3, tool: 'db.kb_search', durationMs: 812, usage: { inputTokens: 1204, outputTokens: 88 } } }
}

// ---------------------------------------------------------------- activity

export function sectorActivity(sectorId: string): Array<{ seq: number; text: string }> {
  void sectorId
  return [
    { seq: 1, text: 'Sector created.' },
    { seq: 2, text: 'Research plan approved as v3.' },
    { seq: 3, text: 'Discovery screened 120 search results.' },
    { seq: 4, text: '40 companies published to the ledger.' },
    { seq: 5, text: 'Coverage page fetched for Bright Spark Electrical.' },
    { seq: 6, text: 'Intake review requested for 3 candidates.' },
    { seq: 7, text: 'Plan v3 approved with 5 search directions.' },
    { seq: 8, text: 'Progress checkpoint recorded at 62 percent.' },
  ]
}
