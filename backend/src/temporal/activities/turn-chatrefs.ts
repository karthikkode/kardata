// Turn chat references: [[session:id|title]] markers, research-chat
// resolution, and bounded text history for prompts.
import type { ChatMessage } from '@kardata/agents'
import { getSession, sessionKind, type Db } from '../../db/index.js'
import { RESEARCH_TOOLS } from './turn-palettes.js'

const CHAT_REF_PATTERN = /\[\[session:([^|\]]+)\|([^\]]*)\]\]/g

/** Research-chat @chat markers. @name is untouched: the gateway routes
 * it to subagents, so references travel as [[session:id|title]]. */
export function parseChatRefs(text: string): Array<{ sessionId: string; title: string }> {
  const refs: Array<{ sessionId: string; title: string }> = []
  for (const match of text.matchAll(CHAT_REF_PATTERN)) {
    refs.push({ sessionId: match[1] ?? '', title: match[2] ?? '' })
  }
  return refs
}

/** Marker-turn override for the research chat: referenced chats resolve
 * to a preload chunk and the grant drops the plan writer for this turn
 * only. Unknown or cross-sector ids drop with a note. Anything else —
 * plain text, normal chats, subagent threads — returns null (no turn
 * override). Re-derived on every attempt, so recovery replays it. */
export async function resolveChatRefTurn(
  pool: Db,
  input: { sessionId: string; threadKey: string; text: string },
): Promise<{ toolAllow: string[]; chunks: string[] } | null> {
  if (parseChatRefs(input.text).length === 0) return null
  if (input.threadKey !== input.sessionId) return null
  const session = await getSession(pool, input.sessionId).catch(() => null)
  if (!session?.sectorId) return null
  const kind = await sessionKind(pool, session.id).catch(() => 'normal' as const)
  if (kind !== 'research') return null
  const seen = new Set<string>()
  const refs: Array<{ sessionId: string; title: string }> = []
  let unknown = false
  for (const marker of parseChatRefs(input.text)) {
    if (seen.has(marker.sessionId)) continue
    seen.add(marker.sessionId)
    const target = await getSession(pool, marker.sessionId).catch(() => null)
    if (!target || target.sectorId !== session.sectorId) {
      unknown = true
      continue
    }
    refs.push({ sessionId: target.id, title: target.title || marker.title })
  }
  const chunks: string[] = []
  if (refs.length > 0) {
    const listed = refs.map((ref) => `${ref.title} (session ${ref.sessionId})`).join(', ')
    chunks.push(`The owner referenced these chats: ${listed}. Read each with db.read_sector_thread, summarize what matters for the research plan, and advise whether the plan should change and how. Do not change the plan in this turn; ask the owner to confirm first.`)
  }
  if (unknown) chunks.push('Referenced chat not found')
  return { toolAllow: [...RESEARCH_TOOLS].filter((name) => name !== 'db.update_sector_plan'), chunks }
}

/** Bounded text history from the thread projection. Tool result payloads are
 * not chat turns and never become free-form instructions in the prompt. */
export function chatHistory(messages: Array<{ kind: string; payload: unknown }>, latestText: string): ChatMessage[] {
  const textTurns: ChatMessage[] = []
  for (const message of messages) {
    if (message.kind !== 'text' || typeof message.payload !== 'object' || message.payload === null) continue
    const payload = message.payload as Record<string, unknown>
    if (payload['role'] !== 'user' && payload['role'] !== 'agent') continue
    if (typeof payload['text'] !== 'string' || payload['failed'] === true) continue
    textTurns.push({ role: payload['role'] === 'user' ? 'user' : 'assistant', text: payload['text'] })
  }
  // The workflow persists this user turn before running the activity. Direct
  // activity callers may not have done so; either way the provider sees it
  // exactly once and receives recent prior turns in their original order.
  if (textTurns.at(-1)?.role === 'user' && textTurns.at(-1)?.text === latestText) textTurns.pop()
  return [...textTurns.slice(-20), { role: 'user', text: latestText }]
}
