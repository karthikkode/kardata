import { compactContext, composeSystemPrompt, type ChatMessage, type ProviderAdapter, type ToolDefinition } from '@kardata/agents'
import { z } from 'zod'
import type { Scope } from './auth/keys.js'
import { getSessionModel, getThread, readThreadContext, requireThread, saveThreadContext, workspaceReferences, type TransactableDb } from './db/index.js'
import { resolveAdapter, resolveEffectiveSelection } from './providers/gateway.js'
import { findModel } from './providers/registry.js'
import { KARBOT_SYSTEM_PROMPT, PRODUCT_TOOLS, SECTOR_TOOLS } from './temporal/activities/turn.js'
import { TOOL_META } from './mcp/tools.js'
import { TOOL_SCHEMAS, type McpToolName } from './mcp/schemas.js'

export async function localContextMessages(db: TransactableDb, threadKey: string, scope?: Scope) {
  const local = await readThreadContext(db, threadKey, scope)
  const thread = await getThread(db, threadKey)
  const rows = (thread?.messages ?? []).filter((row) => {
    const payload = row.payload as { role?: string; text?: string }
    return row.seq > local.coveredSeq && row.kind === 'text' && typeof payload.text === 'string' && (payload.role === 'user' || payload.role === 'agent')
  })
  const messages: ChatMessage[] = rows.flatMap((row) => {
    const payload = row.payload as { text?: string; role?: string; message?: { text?: string; role?: string } }
    const message = payload.message ?? payload
    return typeof message.text === 'string' ? [{ role: message.role === 'user' ? 'user' as const : 'assistant' as const, text: message.text, contextSeq: row.seq }] : []
  })
  return { local, rows, messages: [...(local.summary ? [{ role: 'assistant' as const, text: local.summary, contextSeq: local.coveredSeq }] : []), ...messages] }
}
export async function compactThread(db: TransactableDb, threadKey: string, provider: ProviderAdapter, force: boolean, scope?: Scope, request?: { system: string; tools: ToolDefinition[]; window: number }) {
  const context = await localContextMessages(db, threadKey, scope)
  if (context.messages.length < 4) return { compacted: false, reason: 'History below compaction threshold', context: context.local }
  const result = await compactContext({ provider, messages: context.messages, system: `${request?.system ?? ''}\n${context.local.notes}`, tools: request?.tools ?? [], window: request?.window, force })
  if (!result.needed) return { compacted: false, reason: 'Context is within budget', context: context.local }
  const covered = result.summary.coveredSeq
  if (covered === undefined) throw new Error('Compaction coverage did not match the transcript')
  const saved = await saveThreadContext(db, threadKey, { version: context.local.version, summary: result.summary.summaryText, coveredSeq: covered }, scope)
  return { compacted: true, context: saved }
}
export async function compactOwnerThread(db: TransactableDb, threadKey: string, scope?: Scope) {
  const loaded = await localContextMessages(db, threadKey, scope)
  if (loaded.messages.length < 4) return { compacted: false, reason: 'History below compaction threshold', context: loaded.local }
  const { session } = await requireThread(db, threadKey, scope)
  const selected = resolveEffectiveSelection((await getSessionModel(db, session.id)) ?? {})
  const model = findModel(selected.provider, selected.model ?? '')
  if (!model?.contextWindow) throw new Error('Selected model has no verified context budget')
  const tools = [...(session.sectorId ? SECTOR_TOOLS : PRODUCT_TOOLS)].map((name) => {
    const key = name as McpToolName
    const schema = z.toJSONSchema(TOOL_SCHEMAS[key])
    if (schema.type !== 'object') throw new Error('Tool registry contains a non-object schema')
    // The canonical harness type predates nested JSON schemas. Preserve the
    // exact registry schema for counting, rather than reducing its fields.
    return { name, description: TOOL_META[key].description, parameters: schema as unknown as ToolDefinition['parameters'] }
  })
  const system = composeSystemPrompt(KARBOT_SYSTEM_PROMPT, { preload: session.sectorId ? await workspaceReferences(db, session.sectorId) : [] })
  return compactThread(db, threadKey, resolveAdapter(selected.provider, { model: selected.model }), true, scope, { system, tools, window: model.contextWindow })
}
