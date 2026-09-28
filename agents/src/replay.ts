// Replay assertions over transcripts plus learning-candidate fields. T7.2.
// Replay proves determinism without re-executing tools: recorded call order
// and arguments must match the golden fixture exactly.
import type { TranscriptLine } from './transcript.js'

export interface GoldenCall {
  name: string
  args: Record<string, unknown>
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort()
    const record = value as Record<string, unknown>
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function extractCalls(lines: TranscriptLine[]): GoldenCall[] {
  const calls: GoldenCall[] = []
  for (const line of lines) {
    if (line.kind !== 'tool_call') continue
    const payload = line.payload
    if (typeof payload['name'] !== 'string') {
      throw new Error(`tool_call line ${line.seq} has no name`)
    }
    const args = payload['args']
    calls.push({
      name: payload['name'],
      args: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
    })
  }
  return calls
}

export function assertReplayMatches(lines: TranscriptLine[], golden: GoldenCall[]): void {
  const actual = extractCalls(lines.filter((line) => line.kind !== 'event'))
  if (actual.length !== golden.length) {
    throw new Error(`replay call count ${actual.length} != golden ${golden.length}`)
  }
  for (const [index, call] of actual.entries()) {
    const expected = golden[index] as GoldenCall
    if (call.name !== expected.name || stable(call.args) !== stable(expected.args)) {
      throw new Error(
        `replay call ${index} mismatch: ${call.name}:${stable(call.args)} != ${expected.name}:${stable(expected.args)}`,
      )
    }
  }
}

export type LearningStatus = 'candidate' | 'promoted' | 'rejected'

export interface LearningCandidate {
  id: string
  turnRef: string
  annotation: string
  status: LearningStatus
}

// Annotations become candidates; an eval gate promotes them elsewhere.
// This store holds the fields the pipeline needs, nothing more.
export class LearningStore {
  private readonly candidates = new Map<string, LearningCandidate>()
  private nextId = 1

  propose(turnRef: string, annotation: string): LearningCandidate {
    if (!turnRef.trim() || !annotation.trim()) {
      throw new Error('learning candidate needs a turn ref and annotation')
    }
    const candidate: LearningCandidate = {
      id: `lc-${this.nextId++}`,
      turnRef,
      annotation,
      status: 'candidate',
    }
    this.candidates.set(candidate.id, candidate)
    return candidate
  }

  promote(id: string): LearningCandidate {
    return this.transition(id, 'promoted')
  }

  reject(id: string): LearningCandidate {
    return this.transition(id, 'rejected')
  }

  list(status?: LearningStatus): LearningCandidate[] {
    const all = [...this.candidates.values()]
    return status ? all.filter((candidate) => candidate.status === status) : all
  }

  private transition(id: string, status: LearningStatus): LearningCandidate {
    const candidate = this.candidates.get(id)
    if (!candidate) throw new Error(`unknown learning candidate '${id}'`)
    if (candidate.status !== 'candidate') {
      throw new Error(`candidate '${id}' already ${candidate.status}`)
    }
    candidate.status = status
    return candidate
  }
}
