// Stub domain tools: sector, company, document, evidence, search, fetch.
// T3.3. Interface contracts with canned fixtures. Phase 8 runs the research
// workflow against these; the backend phase replaces handlers, never shapes.
import type { ToolRegistration } from './tools.js'

export interface SectorSummary {
  id: string
  name: string
  companyCount: number
  coverage: 'none' | 'partial' | 'complete'
}

export interface CompanySummary {
  id: string
  name: string
  sectorId: string
  status: 'candidate' | 'verified' | 'rejected'
}

export interface DocumentSummary {
  id: string
  url: string
  title: string
}

export interface EvidenceItem {
  id: string
  docId: string
  url: string
  excerpt: string
}

const SECTORS: SectorSummary[] = [
  { id: 'sector-fintech', name: 'Fintech', companyCount: 3, coverage: 'partial' },
  { id: 'sector-health', name: 'Health', companyCount: 0, coverage: 'none' },
]

const COMPANIES: CompanySummary[] = [
  { id: 'co-1', name: 'Acme Pay', sectorId: 'sector-fintech', status: 'candidate' },
  { id: 'co-2', name: 'Ledgerly', sectorId: 'sector-fintech', status: 'verified' },
  { id: 'co-3', name: 'Coinwell', sectorId: 'sector-fintech', status: 'rejected' },
]

export const DOCUMENT_FIXTURES: DocumentSummary[] = [
  { id: 'doc-1', url: 'https://example.com/acme', title: 'Acme Pay overview' },
  { id: 'doc-2', url: 'https://example.com/ledgerly', title: 'Ledgerly report' },
]

function json(content: unknown): { content: string } {
  return { content: JSON.stringify(content) }
}

function str(name: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return `${name} must be a non-empty string`
  return undefined
}

export function domainTools(): ToolRegistration[] {
  return [
    {
      definition: {
        name: 'sector.list',
        description: 'List sector categories with coverage.',
        parameters: { type: 'object' },
      },
      handler: () => Promise.resolve(json(SECTORS)),
    },
    {
      definition: {
        name: 'company.list',
        description: 'List companies in a sector.',
        parameters: {
          type: 'object',
          properties: { sectorId: { type: 'string' } },
          required: ['sectorId'],
        },
      },
      handler: (args) => {
        const problem = str('sectorId', args['sectorId'])
        if (problem) return Promise.resolve({ content: problem, isError: true })
        return Promise.resolve(json(COMPANIES.filter((co) => co.sectorId === args['sectorId'])))
      },
    },
    {
      definition: {
        name: 'documents.search',
        description: 'Search documents by query substring.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      handler: (args) => {
        const problem = str('query', args['query'])
        if (problem) return Promise.resolve({ content: problem, isError: true })
        const query = String(args['query']).toLowerCase()
        return Promise.resolve(
          json(DOCUMENT_FIXTURES.filter((doc) => `${doc.title} ${doc.url}`.toLowerCase().includes(query))),
        )
      },
    },
    {
      definition: {
        name: 'documents.get',
        description: 'Fetch one document by id.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      handler: (args) => {
        const problem = str('id', args['id'])
        if (problem) return Promise.resolve({ content: problem, isError: true })
        const doc = DOCUMENT_FIXTURES.find((entry) => entry.id === args['id'])
        if (!doc) return Promise.resolve({ content: `unknown document '${String(args['id'])}'`, isError: true })
        return Promise.resolve(json({ ...doc, body: `Canned body of ${doc.title}.` }))
      },
    },
    {
      definition: {
        name: 'evidence.capture',
        description: 'Capture an evidence excerpt against a document.',
        parameters: {
          type: 'object',
          properties: { docId: { type: 'string' }, excerpt: { type: 'string' } },
          required: ['docId', 'excerpt'],
        },
      },
      handler: (args) => {
        const docProblem = str('docId', args['docId'])
        if (docProblem) return Promise.resolve({ content: docProblem, isError: true })
        const excerptProblem = str('excerpt', args['excerpt'])
        if (excerptProblem) return Promise.resolve({ content: excerptProblem, isError: true })
        const doc = DOCUMENT_FIXTURES.find((entry) => entry.id === args['docId'])
        if (!doc) return Promise.resolve({ content: `unknown document '${String(args['docId'])}'`, isError: true })
        const item: EvidenceItem = {
          id: `ev-${doc.id}`,
          docId: doc.id,
          url: doc.url,
          excerpt: String(args['excerpt']),
        }
        return Promise.resolve(json(item))
      },
    },
    {
      definition: {
        name: 'hound.search',
        description: 'Snippet search returning document ids (stub: no fetch).',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      handler: (args) => {
        const problem = str('query', args['query'])
        if (problem) return Promise.resolve({ content: problem, isError: true })
        return Promise.resolve(json(DOCUMENT_FIXTURES.map((doc) => ({ id: doc.id, url: doc.url }))))
      },
    },
  ]
}
