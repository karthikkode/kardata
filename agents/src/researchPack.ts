// Research pack cassette: record-once, replay-forever (Phase G).
// A pack freezes one research capture (scope, retriever documents,
// per-claim findings, assembled report) as versioned JSON under
// `agents/src/fixtures/`. The suite replays packs hermetically with
// the network cut; live runs happen only to (re)capture a pack or
// probe drift. Packs are test data, never knowledge-base corpus.
import { createHash } from 'node:crypto'
import { assembleReport, captureFinding, type Finding, type RetrievedDoc, type Retriever } from './research.js'

export type ResearchPackDoc = RetrievedDoc

export interface ResearchPack {
  version: 1
  scope: string
  scopeHash: string
  documents: ResearchPackDoc[]
  findings: Finding[]
  report: string
  capturedAt: string
}

export function hashScope(scope: string): string {
  return createHash('sha256').update(scope).digest('hex')
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`research pack needs ${name}`)
  return value
}

// Record: build a pack from a live (or stubbed) capture. Findings are
// re-hashed through captureFinding so stored hashes never come from
// an untrusted caller; the report is assembled, never pasted.
export function createResearchPack(input: {
  scope: string
  documents: ResearchPackDoc[]
  findings: Array<{ claim: string; docId: string; url: string; excerpt: string }>
  capturedAt?: string
}): ResearchPack {
  const scope = requireText(input.scope, 'scope')
  for (const doc of input.documents) {
    requireText(doc.id, 'document id')
    requireText(doc.url, 'document url')
    requireText(doc.title, 'document title')
    if (typeof doc.body !== 'string' || !doc.body) throw new Error('research pack needs document body')
  }
  const findings = input.findings.map((entry) => captureFinding(entry))
  return {
    version: 1,
    scope,
    scopeHash: hashScope(scope),
    documents: input.documents.map((doc) => ({ ...doc })),
    findings,
    report: assembleReport(findings),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  }
}

// Replay guard: every field is re-derived and compared. A tampered
// pack throws instead of replaying silently.
export function validateResearchPack(pack: ResearchPack): void {
  if (pack.version !== 1) throw new Error(`research pack version 1 required, saw ${String(pack.version)}`)
  const scope = requireText(pack.scope, 'scope')
  if (pack.scopeHash !== hashScope(scope)) {
    throw new Error('research pack scope hash mismatch: refusing to replay')
  }
  const findings = (pack.findings ?? []).map((entry) => {
    const rebuilt = captureFinding({ claim: entry.claim, docId: entry.docId, url: entry.url, excerpt: entry.excerpt })
    if (rebuilt.contentHash !== entry.contentHash) {
      throw new Error(`research pack content hash mismatch on '${entry.docId}': refusing to replay`)
    }
    return rebuilt
  })
  if (pack.report !== assembleReport(findings)) {
    throw new Error('research pack report mismatch: refusing to replay')
  }
}

// Fail-closed retriever over pack documents: unknown ids throw, and
// the class performs no fetch of its own, so replay with the network
// cut stays green while any live fallback attempt fails loudly.
export class CassetteRetriever implements Retriever {
  constructor(private readonly pack: ResearchPack) {}

  async search(query: string, maxResults: number): Promise<Array<{ id: string; url: string }>> {
    const needle = query.toLowerCase()
    return this.pack.documents
      .filter((doc) => `${doc.title} ${doc.url}`.toLowerCase().includes(needle))
      .slice(0, maxResults)
      .map((doc) => ({ id: doc.id, url: doc.url }))
  }

  async fetch(id: string): Promise<RetrievedDoc> {
    const doc = this.pack.documents.find((entry) => entry.id === id)
    if (!doc) throw new Error(`unknown document '${id}'`)
    return { ...doc }
  }
}
