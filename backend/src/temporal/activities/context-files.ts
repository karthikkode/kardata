// Sector context file summarizer: one standardized AI block per file.
// Workflow histories contain IDs only; the block row is the provenance.
import type { ProviderAdapter, ProviderRequest, ProviderResponse, Usage } from '@kardata/agents'
import { estimateTokens } from '@kardata/agents'
import { randomUUID } from 'node:crypto'
import { Context } from '@temporalio/activity'
import { z } from 'zod'
import { appendProviderRoundEvent } from '../../db/execution-rounds.js'
import { acquireMetaPermit, workerPoolFromEnv, type TransactableDb } from '../../db/index.js'
import { listDocumentUnits } from '../../db/document-units.js'
import { applyReadyContextFileBlock, applySystemCompaction, readGlobalContext, readGlobalContextUsage, recordContextAiUsage } from '../../db/workspace-global-context.js'
import { chunkDocumentUnits, findMissingNumbers, listContextFileBlocks, markContextFileBlockFailed, normalizeSectionsJson, parseJsonObject, readContextFileBlock, validateBlockTemplate } from '../../db/context-files.js'
import { providerRoundFields, resolveAdapter, wrapAdapterWithPermit } from '../../providers/provider-gateway.js'
import { TemporalRunsGateway } from '../runs-gateway.js'
import { WorkspaceError } from '../../db/errors.js'
import { createLogger, logOp } from '../../observability/logging.js'
import { activityLogFields } from '../../observability/temporal-tracing.js'

export interface ContextFileSummaryInput { sectorId: string; fileId: string; hash: string }
export interface ContextCompactionInput { sectorId: string; reason: 'auto' | 'manual' }
export interface ContextFileActivitiesDeps {
  db: TransactableDb
  provider(model: string): ProviderAdapter
  startCompaction?(sectorId: string): Promise<void>
}

export const CONTEXT_FILE_MODEL = 'muse-spark-1.3-contributor'
/** Budget for one file-summary or compaction provider call. The 60 s
 * turn default trips on long generations; background context calls get
 * the same 180 s budget as planning turns. */
export const CONTEXT_FILE_CALL_TIMEOUT_MS = 180_000

/** adapter.chat with a wall-clock budget: aborts the call when the
 * budget elapses so a hung provider cannot stall the activity. */
export async function chatWithTimeout(adapter: ProviderAdapter, request: ProviderRequest, timeoutMs: number = CONTEXT_FILE_CALL_TIMEOUT_MS): Promise<ProviderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`provider call timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    return await adapter.chat({ ...request, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
const CHUNK_TOKENS = 12000
const logger = createLogger({ op: 'context.file.activity' })

/** Stable across activity retries, distinct across concurrent runs:
 * the workflow run id, else a random key for direct unit-test calls. */
function invocationSuffix(): string {
  try {
    const runId = Context.current().info.workflowExecution?.runId
    if (runId) return runId
  } catch { /* direct unit-test call */ }
  return randomUUID()
}

async function recordSpend(db: TransactableDb, sectorId: string, input: { kind: 'file-summary' | 'compaction'; fileId?: string; inputTokens: number; outputTokens: number }): Promise<void> {
  if (input.inputTokens + input.outputTokens <= 0) return
  let attempt: string = randomUUID()
  try {
    const info = Context.current().info
    const runId = info.workflowExecution?.runId
    if (runId) attempt = `${runId}:${info.attempt}`
  } catch {
    // No worker context (direct unit-test call): the random key stands.
  }
  await recordContextAiUsage(db, { sectorId, idempotencyKey: `ai-usage:${attempt}`, usage: { ...input, model: CONTEXT_FILE_MODEL } })
}

function fileType(filename: string): string {
  const ext = filename.split('.').pop()?.trim() ?? ''
  return ext && ext !== filename ? ext.toUpperCase() : 'FILE'
}

export function buildContextFilePrompt(filename: string, chunkText: string, pageLine: string | null): string {
  const title = pageLine ? `### ${filename} (${fileType(filename)}, ${pageLine})` : `### ${filename} (${fileType(filename)})`
  return `Summarize this file into ONE standardized context block. Reply with ONLY the block, using exactly this template with headings in this order:

${title}
**Overview.** <2-3 sentences>
**Key facts**
- <fact, every number, date, currency and unit copied exactly>
**Entities**
- Companies: ... ; People: ... ; Places: ...
**Tables and data**
<each source table kept as a Markdown table; "None" if none>
**Gaps or unclear parts**
- <what could not be read or is uncertain; "None" if none>
Source: full original in Files ▸ ${filename}

Rules: copy every number, date, currency and unit exactly as written; never round or reformat. Omit the page count when the source has no page info.

File content:
${chunkText}`
}

function buildPartialPrompt(filename: string, chunkText: string, index: number, total: number): string {
  return `Take partial notes on part ${index + 1} of ${total} of the file ${filename}, using the same headings (Overview, Key facts, Entities, Tables and data, Gaps or unclear parts). Copy every number, date, currency and unit exactly. This is an intermediate step; a later step merges all parts into the final block.\n\nFile content part ${index + 1}:\n${chunkText}`
}

function buildMergePrompt(filename: string, partials: string[], pageLine: string | null): string {
  const title = pageLine ? `### ${filename} (${fileType(filename)}, ${pageLine})` : `### ${filename} (${fileType(filename)})`
  return `Merge these partial notes on ${filename} into ONE standardized context block. Reply with ONLY the block, using exactly this template with headings in this order:

${title}
**Overview.** <2-3 sentences>
**Key facts**
- <fact, every number, date, currency and unit copied exactly>
**Entities**
- Companies: ... ; People: ... ; Places: ...
**Tables and data**
<each source table kept as a Markdown table; "None" if none>
**Gaps or unclear parts**
- <what could not be read or is uncertain; "None" if none>
Source: full original in Files ▸ ${filename}

Rules: keep every number, date, currency and unit from the partials, copied exactly; never round or reformat.

Partial notes:
${partials.join('\n\n---\n\n')}`
}

export interface ContextFileRoundTracker {
  kind: 'file-summary' | 'compaction'
  runId: string
  threadKey: string
  counter: { n: number }
}

export function createContextFileActivities(deps: ContextFileActivitiesDeps) {
  async function chat(text: string, spend: { inputTokens: number; outputTokens: number }, ids: { sectorId: string; fileId?: string }, systemPrompt = 'You summarize files into standardized context blocks. Reply with only the requested block or notes.', track?: ContextFileRoundTracker): Promise<string> {
    const adapter = deps.provider(CONTEXT_FILE_MODEL)
    const started = Date.now()
    const round = track ? (track.counter.n += 1) : 0
    let attempt = 1
    try { attempt = Context.current().info.attempt } catch { /* direct unit-test call */ }
    const codeOf = (error: unknown): string => error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'provider_failed'
    const record = async (outcome: 'ok' | 'error' | 'timeout', usage?: Usage, errorCode?: string): Promise<void> => {
      if (!track) return
      const finishedAt = Date.now()
      try {
        await appendProviderRoundEvent(deps.db, `sector:${ids.sectorId}`, `provider-round:${track.runId}:${track.threadKey}:${round}:${attempt}`, {
          runId: track.runId, threadKey: track.threadKey, sessionId: null, sectorId: ids.sectorId, turnKind: track.kind,
          round, attempt, model: CONTEXT_FILE_MODEL, provider: adapter.providerName,
          startedAt: new Date(started).toISOString(), finishedAt: new Date(finishedAt).toISOString(), latencyMs: finishedAt - started,
          inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, cachedTokens: usage?.cacheReadTokens ?? null,
          outcome, ...(errorCode ? { errorCode } : {}),
        })
      } catch (error) {
        logger.warn({ event: 'context.file.round_record_failed', ...activityLogFields({ sectorId: ids.sectorId }), code: error instanceof Error ? error.name : 'unknown', round })
      }
    }
    try {
      const response = await chatWithTimeout(adapter, { systemPrompt, messages: [{ role: 'user', text }], tools: [], toolChoice: { mode: 'none' } })
      spend.inputTokens += response.usage.inputTokens
      spend.outputTokens += response.usage.outputTokens
      logger.info({ ...activityLogFields({ sectorId: ids.sectorId }), ...providerRoundFields({ provider: adapter.providerName, model: CONTEXT_FILE_MODEL, latencyMs: Date.now() - started, usage: response.usage, outcome: 'ok' }), ...(ids.fileId ? { fileId: ids.fileId } : {}) })
      await record('ok', response.usage)
      return response.text
    } catch (error) {
      logger.error({ ...activityLogFields({ sectorId: ids.sectorId }), ...providerRoundFields({ provider: adapter.providerName, model: CONTEXT_FILE_MODEL, latencyMs: Date.now() - started, outcome: 'error', code: codeOf(error) }), ...(ids.fileId ? { fileId: ids.fileId } : {}) })
      const timedOut = error instanceof Error && /timed out/i.test(error.message)
      await record(timedOut ? 'timeout' : 'error', undefined, timedOut ? 'provider_timeout' : codeOf(error))
      throw error
    }
  }
  return {
    async summarizeContextFileActivity(input: ContextFileSummaryInput): Promise<{ applied: boolean }> {
      return logOp(logger, 'context.file.summarize', async () => {
        const block = await readContextFileBlock(deps.db, input.sectorId, input.fileId)
        // Removed while summarizing: stay removed, no re-insert.
        if (!block || block.hash !== input.hash) return { applied: false }
        const units = (await listDocumentUnits(deps.db, block.documentId)).sort((a, b) => a.ord - b.ord)
        if (!units.length) {
          await markContextFileBlockFailed(deps.db, input.sectorId, input.fileId, 'file has no readable units')
          return { applied: false }
        }
        const spend = { inputTokens: 0, outputTokens: 0 }
        const track: ContextFileRoundTracker = { kind: 'file-summary', runId: `file-summary:${input.fileId}:${invocationSuffix()}`, threadKey: `sector-file:${input.sectorId}:${input.fileId}`, counter: { n: 0 } }
        try {
          const pages = units.map((unit) => unit.page).filter((page): page is number => typeof page === 'number')
          const pageLine = pages.length ? `${Math.max(...pages)} pages` : null
          const source = units.map((unit) => unit.text).join('\n')
          const chunks = chunkDocumentUnits(units, CHUNK_TOKENS, estimateTokens)
          let summary: string
          if (chunks.length <= 1) {
            summary = await chat(buildContextFilePrompt(block.filename, source, pageLine), spend, { sectorId: input.sectorId, fileId: input.fileId }, undefined, track)
          } else {
            const partials: string[] = []
            for (const [index, chunk] of chunks.entries()) partials.push(await chat(buildPartialPrompt(block.filename, chunk.map((unit) => unit.text).join('\n'), index, chunks.length), spend, { sectorId: input.sectorId, fileId: input.fileId }, undefined, track))
            summary = await chat(buildMergePrompt(block.filename, partials, pageLine), spend, { sectorId: input.sectorId, fileId: input.fileId }, undefined, track)
          }
          // One deterministic repair round: missing numbers plus template issues.
          const missing = findMissingNumbers(source, summary)
          const templateIssues = validateBlockTemplate(summary)
          if (missing.length > 0 || templateIssues.length > 0) {
            const repair = [`The block has these defects; reply with the full corrected block only:`]
            for (const entry of missing) repair.push(`- Missing exact value ${entry.token} (source context: "${entry.snippet}")`)
            for (const issue of templateIssues) repair.push(`- Template: ${issue}`)
            repair.push(`\nCurrent block:\n${summary}`)
            summary = await chat(repair.join('\n'), spend, { sectorId: input.sectorId, fileId: input.fileId }, undefined, track)
          }
          const stillMissing = findMissingNumbers(source, summary)
          if (stillMissing.length > 0) {
            summary += `\n**Additional figures**\n${stillMissing.map((entry) => `- ${entry.token}: "${entry.snippet}"`).join('\n')}`
          }
          const applied = await applyReadyContextFileBlock(deps.db, { sectorId: input.sectorId, fileId: input.fileId, summary, tokens: estimateTokens(summary), inputTokens: spend.inputTokens, outputTokens: spend.outputTokens })
          if (applied && deps.startCompaction) {
            const usage = await readGlobalContextUsage(deps.db, input.sectorId)
            if (usage.total >= usage.budget * 0.7) await deps.startCompaction(input.sectorId)
          }
          return { applied: applied !== null }
        } catch (error) {
          await markContextFileBlockFailed(deps.db, input.sectorId, input.fileId, error instanceof Error ? error.message : 'summarizer failed')
          throw error
        } finally {
          await recordSpend(deps.db, input.sectorId, { kind: 'file-summary', fileId: input.fileId, ...spend })
        }
      }, { ...activityLogFields({ sectorId: input.sectorId }), fileId: input.fileId })
    },
    async compactGlobalContextActivity(input: ContextCompactionInput): Promise<{ compacted: boolean; version?: number }> {
      return logOp(logger, 'context.compaction', async () => {
        const usage = await readGlobalContextUsage(deps.db, input.sectorId)
        // A stale auto trigger stands down; a manual run always compacts.
        if (input.reason === 'auto' && usage.total < usage.budget * 0.7) return { compacted: false }
        const spend = { inputTokens: 0, outputTokens: 0 }
        const track: ContextFileRoundTracker = { kind: 'compaction', runId: `global-compaction:${input.sectorId}:${invocationSuffix()}`, threadKey: `sector-context:${input.sectorId}`, counter: { n: 0 } }
        try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const context = await readGlobalContext(deps.db, input.sectorId, undefined, false)
          const blocks = await listContextFileBlocks(deps.db, input.sectorId)
          const source = [context.sections.decisions, context.sections.findings, context.sections.questions].join('\n\n')
          const system = 'You compact context sections. Reply with only a valid JSON object of the requested shape, no prose and no fences.'
          const shape = 'Return a JSON object with exactly three string keys: {"decisions": "...", "findings": "...", "questions": "..."}. Each value is one Markdown string, never an array.'
          const reply = await chat(`Shorten these sections to at most half their tokens. Keep every decision, every number, every company name and every open question; merge duplicates; remove filler. ${shape}\n\nDecisions:\n${context.sections.decisions}\n\nFindings:\n${context.sections.findings}\n\nOpen questions:\n${context.sections.questions}`, spend, { sectorId: input.sectorId }, system, track)
          let sections = CompactedSections.safeParse(normalizeSectionsJson(parseJsonObject(reply)))
          if (!sections.success) {
            const retry = await chat(`Return ONLY valid JSON with the same shortened content. ${shape} No prose, no fences.\n\nPrevious reply:\n${reply}`, spend, { sectorId: input.sectorId }, system, track)
            sections = CompactedSections.safeParse(normalizeSectionsJson(parseJsonObject(retry)))
          }
          if (!sections.success) {
            logger.warn({ event: 'context.compaction.bad-json', sectorId: input.sectorId, preview: reply.slice(0, 300) }, 'Compaction reply was not valid section JSON')
            throw new WorkspaceError('conflict', 'Compaction did not return valid section JSON.')
          }
          const compacted = { ...sections.data }
          const missing = findMissingNumbers(source, [compacted.decisions, compacted.findings, compacted.questions].join('\n\n'))
          if (missing.length > 0) {
            const repair = await chat(`These exact values from the source are missing from your shortened sections; reply with the full corrected JSON only, same shape (three string keys, never arrays):\n${missing.map((entry) => `- ${entry.token} (source context: "${entry.snippet}")`).join('\n')}\n\nCurrent JSON:\n${JSON.stringify(compacted)}`, spend, { sectorId: input.sectorId }, system, track)
            const repaired = CompactedSections.safeParse(normalizeSectionsJson(parseJsonObject(repair)))
            if (repaired.success) Object.assign(compacted, repaired.data)
          }
          const stillMissing = findMissingNumbers(source, [compacted.decisions, compacted.findings, compacted.questions].join('\n\n'))
          if (stillMissing.length > 0) compacted.findings += `\nAdditional figures\n${stillMissing.map((entry) => `- ${entry.token}: "${entry.snippet}"`).join('\n')}`
          if (estimateTokens(compacted.decisions) + estimateTokens(compacted.findings) + estimateTokens(compacted.questions) >= estimateTokens(source)) {
            throw new WorkspaceError('conflict', 'Compaction did not shrink the context.')
          }
          try {
            const applied = await applySystemCompaction(deps.db, {
              sectorId: input.sectorId, baseVersion: context.version, reason: input.reason,
              baseScope: context.sections.scope, baseInstructions: context.sections.instructions,
              baseBlocks: blocks.map((block) => ({ fileId: block.fileId, hash: block.hash, state: block.state })),
              sections: compacted, inputTokens: spend.inputTokens, outputTokens: spend.outputTokens,
            })
            logger.info({ event: 'context.compaction.spend', sectorId: input.sectorId, ...spend }, 'Global context compaction spend')
            return { compacted: true, version: applied.version }
          } catch (error) {
            // One full retry on a concurrent change, then silent stand-down.
            if (!(error instanceof WorkspaceError) || error.code !== 'conflict' || attempt > 0) {
              if (error instanceof WorkspaceError && error.code === 'conflict') {
                logger.info({ event: 'context.compaction.stand-down', sectorId: input.sectorId }, 'Global context changed during compaction; standing down')
                return { compacted: false }
              }
              throw error
            }
          }
        }
        return { compacted: false }
        } finally {
          await recordSpend(deps.db, input.sectorId, { kind: 'compaction', ...spend })
        }
      }, { ...activityLogFields({ sectorId: input.sectorId }), reason: input.reason })
    },
  }
}



const CompactedSections = z.object({ decisions: z.string(), findings: z.string(), questions: z.string() }).strip()

function production() {
  const db = workerPoolFromEnv()
  return createContextFileActivities({
    db,
    provider: (model) => wrapAdapterWithPermit(resolveAdapter('meta', { model }), () => acquireMetaPermit(db, `context-file:${randomUUID()}`)),
    startCompaction: (sectorId) => new TemporalRunsGateway(db).startContextCompaction(sectorId, 'auto').then(() => undefined),
  })
}
export const summarizeContextFileActivity = (input: ContextFileSummaryInput) => production().summarizeContextFileActivity(input)
export const compactGlobalContextActivity = (input: ContextCompactionInput) => production().compactGlobalContextActivity(input)
