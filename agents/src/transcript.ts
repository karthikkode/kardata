// Append-only JSONL transcript with versioned schema, secret redaction,
// and replay projections. T7.1. UI-only events are recorded but excluded
// from replay: replay must reproduce decisions, not pixels.
import type { Clock } from './clock.js'

export const TRANSCRIPT_VERSION = 1

export type TranscriptKind =
  | 'session'
  | 'turn'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'provider_envelope'
  | 'usage'
  | 'checkpoint'
  | 'event'

const KINDS: TranscriptKind[] = [
  'session',
  'turn',
  'message',
  'tool_call',
  'tool_result',
  'provider_envelope',
  'usage',
  'checkpoint',
  'event',
]

export interface TranscriptLine {
  v: number
  ts: number
  seq: number
  runId: string
  kind: TranscriptKind
  payload: Record<string, unknown>
}

function scrub(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    let out = value
    for (const secret of secrets) {
      if (secret) out = out.split(secret).join('[redacted]')
    }
    return out
  }
  if (Array.isArray(value)) return value.map((entry) => scrub(entry, secrets))
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) out[key] = scrub(entry, secrets)
    return out
  }
  return value
}

export class TranscriptWriter {
  private seq = 0
  private readonly lines: TranscriptLine[] = []

  constructor(
    private readonly runId: string,
    private readonly clock: Clock,
    private readonly secrets: string[] = [],
  ) {}

  append(kind: TranscriptKind, payload: Record<string, unknown>): TranscriptLine {
    const line: TranscriptLine = {
      v: TRANSCRIPT_VERSION,
      ts: this.clock.now(),
      seq: this.seq++,
      runId: this.runId,
      kind,
      payload: scrub(payload, this.secrets) as Record<string, unknown>,
    }
    this.lines.push(line)
    return line
  }

  all(): TranscriptLine[] {
    return [...this.lines]
  }

  // Replay projection: everything that drove decisions, minus UI-only events.
  replayable(): TranscriptLine[] {
    return this.lines.filter((line) => line.kind !== 'event')
  }

  toJsonl(): string {
    return this.lines.map((line) => JSON.stringify(line)).join('\n')
  }

  static fromJsonl(text: string): TranscriptLine[] {
    if (!text.trim()) return []
    return text.split('\n').map((row, index) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(row)
      } catch {
        throw new Error(`transcript line ${index} is not JSON`)
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`transcript line ${index} is not an object`)
      }
      const line = parsed as Record<string, unknown>
      if (line['v'] !== TRANSCRIPT_VERSION) {
        throw new Error(`transcript line ${index} has unsupported version`)
      }
      if (
        typeof line['ts'] !== 'number' ||
        typeof line['seq'] !== 'number' ||
        typeof line['runId'] !== 'string' ||
        typeof line['kind'] !== 'string' ||
        !KINDS.includes(line['kind'] as TranscriptKind) ||
        typeof line['payload'] !== 'object' ||
        line['payload'] === null
      ) {
        throw new Error(`transcript line ${index} fails schema validation`)
      }
      return line as unknown as TranscriptLine
    })
  }
}
