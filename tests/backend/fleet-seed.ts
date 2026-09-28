// Deterministic TEST fleet generator for thousand-company scale runs.
// Same (seed, companyCount, docCount) always yields the same rows, so
// reruns are free and goldens stay stable. Every name and file carries
// its TEST label: generated rows can never pass as live data.
// Seeded PRNG (mulberry32): no dependencies, no network, no randomness
// outside the seed.
import type { CompanyStage } from '../../backend/src/db/sectors.js'

export interface FleetCompany {
  name: string
  stage: CompanyStage
}

export interface FleetDoc {
  filename: string
  text: string
}

const ADJECTIVES = [
  'Amber', 'Basalt', 'Cinder', 'Drift', 'Ember', 'Flint', 'Gale', 'Harbor',
  'Ion', 'Juniper', 'Kestrel', 'Lumen', 'Mesa', 'North', 'Opal', 'Pine',
  'Quartz', 'Ridge', 'Sable', 'Tundra', 'Umber', 'Vega', 'Willow', 'Yonder',
]

const NOUNS = [
  'Pay', 'Ledger', 'Mint', 'Vault', 'Rail', 'Settle', 'Credit', 'Capital',
  'Fund', 'Trade', 'Bond', 'Equity', 'Prime', 'Trust', 'Secure', 'Clear',
  'Swift', 'Bright', 'Novapay', 'Finch', 'Corelane', 'Bluefin', 'Redwood',
  'Starling', 'Parcel', 'Freight', 'Cargo', 'Harbor', 'Anchor', 'Beacon',
  'Signal', 'Relay', 'Vector', 'Pixel', 'Forge', 'Anvil', 'Compass', 'Atlas',
  'Summit', 'Harbor',
]

const STAGES: CompanyStage[] = ['Filter', 'Deep research', 'Problem found', 'Final validation']

const SECTORS = ['SME payments', 'cross-border payouts', 'real-time ledgers', 'escrow services']

const PARAGRAPH =
  'TEST DATA: this company is generated for thousand-company scale runs and is not a real business. ' +
  'It processes test transactions on a test ledger. Figures below are fixed per seed and carry no market meaning. '

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function generateFleet(seed: number, companyCount: number, docCount: number): { companies: FleetCompany[]; docs: FleetDoc[] } {
  if (!Number.isInteger(companyCount) || companyCount < 0) throw new Error('companyCount must be a non-negative integer')
  if (!Number.isInteger(docCount) || docCount < 0) throw new Error('docCount must be a non-negative integer')
  const rand = mulberry32(seed)
  const companies: FleetCompany[] = []
  for (let i = 0; i < companyCount; i++) {
    const adjective = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)] as string
    const noun = NOUNS[Math.floor(rand() * NOUNS.length)] as string
    const serial = String(i).padStart(4, '0')
    companies.push({ name: `TEST ${adjective} ${noun} ${serial}`, stage: STAGES[i % STAGES.length] as CompanyStage })
  }
  const docs: FleetDoc[] = []
  for (let i = 0; i < docCount; i++) {
    const company = companies[(i * 83) % Math.max(companies.length, 1)] ?? { name: 'TEST Placeholder 0000', stage: 'Filter' as CompanyStage }
    const sector = SECTORS[i % SECTORS.length]
    const big = i % 3 === 2
    const repeats = big ? 12 : 2
    const body = Array.from({ length: repeats }, () => PARAGRAPH).join('') +
      `Covers ${company.name} in ${sector}. Founded in test year ${2000 + (i % 24)}. ` +
      `Headquarters: Test City ${i}. Flagship: test product ${i}.`
    docs.push({ filename: `test-fleet-${String(i).padStart(3, '0')}.md`, text: `# ${company.name}\n\n${body}\n` })
  }
  return { companies, docs }
}
