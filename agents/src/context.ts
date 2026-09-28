// Context assembly, provider cache policy, snapshots. T5.1. Rules enforced
// here: stable-prefix-first ordering, deterministic serialization,
// append-only history, volatile content last.
import { createHash } from 'node:crypto'
import type {
  ChatMessage,
  ProviderRequest,
  ToolChoice,
  ToolDefinition,
} from './providers.js'

export interface AssembleInput {
  system: string[]
  tools: ToolDefinition[]
  /** Pinned reference docs: stable, billed as prefix. */
  references: string[]
  /** Append-only history: oldest first, never edited in place. */
  history: ChatMessage[]
  /** Volatile tail: timestamps, fresh retrieval, newest user message. */
  tail: ChatMessage[]
  toolChoice?: ToolChoice
}

export function assembleContext(input: AssembleInput): ProviderRequest {
  const systemPrompt = [...input.system, ...input.references].join('\n\n')
  return {
    systemPrompt,
    messages: [...input.history, ...input.tail],
    tools: [...input.tools],
    toolChoice: input.toolChoice ?? { mode: 'auto' },
  }
}

// Canonical bytes of a request. Same logical request always hashes
// identically: tool order is registry order, key order is construction order,
// and history is append-only. Any re-render that changes bytes is a bug.
export function canonicalRequestBytes(request: ProviderRequest): string {
  return JSON.stringify({
    systemPrompt: request.systemPrompt,
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
  })
}

export type CacheProvider = 'anthropic' | 'openai' | 'meta'

export interface CachePolicy {
  provider: CacheProvider
  /** Whether Karbot knows the documented semantics. Meta: false until probes. */
  known: boolean
  maxBreakpoints?: number
  defaultTtlMinutes?: number
  lookbackBlocks?: number
  minCacheableTokens?: number
  automatic?: boolean
}

// Documented prefix-caching rules per provider (researcher-verified docs).
// Adapters consume these; unknown providers stay unshaped.
export function describeCachePolicy(provider: CacheProvider): CachePolicy {
  switch (provider) {
    case 'anthropic':
      return {
        provider,
        known: true,
        maxBreakpoints: 4,
        defaultTtlMinutes: 5,
        lookbackBlocks: 20,
      }
    case 'openai':
      return { provider, known: true, minCacheableTokens: 1024, automatic: true }
    case 'meta':
      // Meta Model API: automatic prefix caching, no flags or breakpoints
      // (dev.meta.ai/docs/prompt-caching). Stable-first ordering is the
      // only client lever; usage reports cached_tokens.
      return { provider, known: true, automatic: true }
  }
}

/** Rough token estimate for meter and pre-call condense decisions: four
 * characters per token. A documented heuristic, never a billing input —
 * billed usage always comes from provider counters. */
export const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4

export function estimateTokens(text: string | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN)
}

/** Rough per-image estimate: providers tile and re-encode images, so byte
 * length misleads. A standing heuristic, never billed. */
export const IMAGE_ESTIMATE_TOKENS = 1500

/** Estimate for one message: visible text plus tool-call and tool-result
 * payloads, which ride the context exactly like text. */
export function estimateMessageTokens(message: ChatMessage): number {
  let total = estimateTokens(message.text)
  if (message.toolCalls !== undefined) total += estimateTokens(JSON.stringify(message.toolCalls))
  if (message.toolResult !== undefined) total += estimateTokens(JSON.stringify(message.toolResult))
  if (message.images !== undefined) total += message.images.length * IMAGE_ESTIMATE_TOKENS
  return total
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}

export interface ContextSegmentUsage {
  messages: number
  estimatedTokens: number
}

export interface ContextUsage {
  system: ContextSegmentUsage
  references: ContextSegmentUsage
  history: ContextSegmentUsage
  tail: ContextSegmentUsage
  totalEstimatedTokens: number
}

// Per-segment sizes of one assembled context: the same four segments the
// provider receives, measured so the UI meter shows exactly what the model
// sees. Estimates only; provider counters remain the billed source.
export function describeSegments(input: AssembleInput): ContextUsage {
  const system: ContextSegmentUsage = {
    messages: input.system.length,
    estimatedTokens: input.system.reduce((total, text) => total + estimateTokens(text), 0),
  }
  const references: ContextSegmentUsage = {
    messages: input.references.length,
    estimatedTokens: input.references.reduce((total, text) => total + estimateTokens(text), 0),
  }
  const history: ContextSegmentUsage = {
    messages: input.history.length,
    estimatedTokens: estimateMessagesTokens(input.history),
  }
  const tail: ContextSegmentUsage = {
    messages: input.tail.length,
    estimatedTokens: estimateMessagesTokens(input.tail),
  }
  return {
    system,
    references,
    history,
    tail,
    totalEstimatedTokens:
      system.estimatedTokens + references.estimatedTokens + history.estimatedTokens + tail.estimatedTokens,
  }
}

export interface ReferenceEntry {
  documentId: string
  ord: number
  text: string
}

/** Canonical citation for one pinned unit. The drawer and the request share
 * this format, so what the user sees is byte-close to what the model gets. */
export function formatReference(documentId: string, ord: number, text: string): string {
  return `[${documentId}:${ord}] ${text}`
}

/** Deterministic reference assembly: sorted by document then ord, exact
 * duplicates dropped. Same selection always yields the same array, which
 * keeps prefix-cache hits stable across turns and sessions. */
export function assembleReferences(entries: ReferenceEntry[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const sorted = [...entries].sort((left, right) =>
    left.documentId < right.documentId
      ? -1
      : left.documentId > right.documentId
        ? 1
        : left.ord - right.ord,
  )
  for (const entry of sorted) {
    const cited = formatReference(entry.documentId, entry.ord, entry.text)
    if (seen.has(cited)) continue
    seen.add(cited)
    out.push(cited)
  }
  return out
}

export function partitionHistory(
  messages: ChatMessage[],
  volatileTailCount: number,
): { stable: ChatMessage[]; volatile: ChatMessage[] } {
  const count = Math.max(0, Math.min(volatileTailCount, messages.length))
  return {
    stable: messages.slice(0, messages.length - count),
    volatile: messages.slice(messages.length - count),
  }
}

export interface ContextSnapshot {
  hash: string
  messageCount: number
  toolCount: number
  toolVersions: Record<string, string>
  promptVersion: string
  policyVersion: string
  parentHash?: string
}

// Snapshot before every provider call: ordered messages, tools, versions,
// parent linkage. Continuation rehydrates from snapshots, never worker memory.
export function createSnapshot(
  request: ProviderRequest,
  versions: { tools: Record<string, string>; prompt: string; policy: string },
  parentHash?: string,
): ContextSnapshot {
  const hash = createHash('sha256').update(canonicalRequestBytes(request)).digest('hex')
  const snapshot: ContextSnapshot = {
    hash,
    messageCount: request.messages.length,
    toolCount: request.tools.length,
    toolVersions: { ...versions.tools },
    promptVersion: versions.prompt,
    policyVersion: versions.policy,
  }
  if (parentHash) snapshot.parentHash = parentHash
  return snapshot
}
