// KB ingest: parses curated knowledge_base/*.md (front-matter + ##
// sections), chunks by section, pins each doc to its listed source files'
// SHA-256, and records one versioned batch. Re-runs supersede prior batches
// per source path; history is never deleted. Pure parse/chunk helpers are
// unit-tested without a database.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { recordKbBatch, type Db, type KbDocumentInput } from './index.js'

const FrontMatter = z.object({
  topic: z.string().min(1).max(80),
  sources: z.array(z.string().min(1)).default([]),
})

export interface ParsedKbDoc {
  topic: string
  title: string
  file: string
  sources: string[]
  chunks: Array<{ section: string; text: string }>
}

/** Minimal front-matter reader: --- block with topic: and sources: [- ...]. */
export function parseKbFile(file: string, text: string): ParsedKbDoc | undefined {
  if (file.startsWith('_')) return undefined
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return undefined
  const [, rawMeta, body] = match as [string, string, string]
  const topic = rawMeta.split('\n').find((line) => line.startsWith('topic:'))?.slice('topic:'.length).trim() ?? ''
  const sources: string[] = []
  let inSources = false
  for (const line of rawMeta.split('\n')) {
    if (line.startsWith('sources:')) {
      inSources = true
      continue
    }
    if (inSources) {
      const item = line.match(/^\s*-\s*(.+)$/)
      if (item?.[1]) sources.push(item[1].trim())
      else if (line.trim().length > 0) inSources = false
    }
  }
  const meta = FrontMatter.safeParse({ topic, sources })
  if (!meta.success) return undefined
  const titleMatch = body.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1]?.trim() ?? file.replace(/\.md$/, '')
  const chunks: ParsedKbDoc['chunks'] = []
  const sections = body.split(/^##\s+/m)
  const preamble = (sections[0] ?? '').trim()
  if (preamble.length > 0) chunks.push({ section: 'overview', text: preamble.slice(0, 8000) })
  for (const section of sections.slice(1)) {
    const newline = section.indexOf('\n')
    const sectionTitle = (newline === -1 ? section : section.slice(0, newline)).trim().slice(0, 200)
    const sectionBody = (newline === -1 ? '' : section.slice(newline + 1)).trim()
    if (sectionBody.length > 0) chunks.push({ section: sectionTitle, text: sectionBody.slice(0, 8000) })
  }
  if (chunks.length === 0) return undefined
  return { topic: meta.data.topic, title, file, sources: meta.data.sources, chunks }
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

const SOURCE_ROOT = '/home/karthik/projects/kardata'

/** Provenance pin: SHA-256 over the curated text plus every readable listed
 * source file, so the pin covers both the curation and its sources. No
 * readable source yields an explicit unpinned marker. */
function provenanceSha(doc: ParsedKbDoc, curatedText: string): string {
  const hash = createHash('sha256')
  hash.update(curatedText)
  let pinned = 0
  for (const source of doc.sources) {
    const path = join(SOURCE_ROOT, source)
    if (existsSync(path)) {
      hash.update(readFileSync(path))
      pinned += 1
    }
  }
  if (pinned === 0) return `unpinned:${sha256Hex(curatedText)}`
  return hash.digest('hex')
}

export function collectKbDocs(dir: string): KbDocumentInput[] {
  const docs: KbDocumentInput[] = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
    const text = readFileSync(join(dir, file), 'utf8')
    const parsed = parseKbFile(file, text)
    if (!parsed) continue
    docs.push({
      topic: parsed.topic,
      title: parsed.title,
      sourcePath: `knowledge_base/${file}`,
      sourceSha: provenanceSha(parsed, text),
      chunks: parsed.chunks,
    })
  }
  return docs
}

export async function runKbIngest(db: Db, dir: string, batchId: string): Promise<{ batchId: string; docs: number }> {
  const docs = collectKbDocs(dir)
  if (docs.length === 0) throw new Error(`no ingestible kb docs in ${dir}`)
  await recordKbBatch(db, batchId, docs)
  return { batchId, docs: docs.length }
}
