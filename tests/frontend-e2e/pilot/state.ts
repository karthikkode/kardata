// Pilot run state: shared across step specs so a run resumes after a
// crash instead of restarting. Tag + worktree come from the
// environment; state lives in var/pilot/run-<tag>/state.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PilotState {
  tag: string
  sectorId?: string
  sectorName?: string
  chats: Record<string, string>
  tiersDone: string[]
  notes: string[]
  /** P2: uploads done (re-runs skip re-uploading the same fixtures). */
  uploadsDone?: boolean
  /** P4: completed spawn marks (re-runs resume past them). */
  p4done?: string[]
  /** P5: completed plan marks (advise/write; turns take ~30 min). */
  p5done?: string[]
  /** P2: nudge timestamps per chat key (idle turn ended with no findings doc). */
  p2nudges?: Record<string, number[]>
}

export function pilotTag(): string {
  const tag = process.env['KARDATA_PILOT_TAG']
  if (!tag) throw new Error('pilot specs need KARDATA_PILOT_TAG (e.g. r1)')
  return tag
}

export function pilotWorktree(): string {
  const worktree = process.env['KARDATA_PILOT_WORKTREE']
  if (!worktree) throw new Error('pilot specs need KARDATA_PILOT_WORKTREE (pilot up --worktree path)')
  return worktree
}

export function runDir(tag = pilotTag()): string {
  const dir = join(pilotWorktree(), 'var', 'pilot', `run-${tag}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function evidenceDir(step: string, tag = pilotTag()): string {
  const dir = join(runDir(tag), 'evidence', step)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function loadState(tag = pilotTag()): PilotState {
  const file = join(runDir(tag), 'state.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as PilotState
  return { tag, chats: {}, tiersDone: [], notes: [] }
}

export function saveState(patch: Partial<PilotState>, tag = pilotTag()): PilotState {
  const next = { ...loadState(tag), ...patch, tag }
  writeFileSync(join(runDir(tag), 'state.json'), JSON.stringify(next, null, 2))
  return next
}

/** Gated like the live journeys: without KARDATA_PILOT_RUN=1 every
 * pilot spec skips explicitly (Playwright still parses the files). */
export function pilotRunEnabled(): boolean {
  return process.env['KARDATA_PILOT_RUN'] === '1'
}

/** Company target for the run: r0 shakes out with 5, r1 counts 100. */
export function pilotCompanies(): number {
  const raw = process.env['KARDATA_PILOT_COMPANIES'] ?? '100'
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 1) throw new Error(`KARDATA_PILOT_COMPANIES=${raw} is not a positive integer`)
  return n
}

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

/** Occurrence kinds: harness workarounds a spec performs. Deliberate
 * test actions (p12's own reload) are step marks, not occurrences. */
export type OccurrenceKind = 'nudge' | 'reload' | 'resume' | 're-pick'

export interface PilotOccurrence {
  at: string
  step: string
  kind: OccurrenceKind
  detail: string
}

/** Append one workaround occurrence to the run's issue-log input
 * (`var/pilot/run-<tag>/occurrences.json`). Every nudge, reload
 * recovery, resume click or re-pick logs here, so r1 counts the
 * workarounds instead of letting them hide product issues (F8). */
export function logOccurrence(step: string, kind: OccurrenceKind, detail: string, tag = pilotTag()): void {
  const file = join(runDir(tag), 'occurrences.json')
  const existing = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PilotOccurrence[]) : []
  existing.push({ at: new Date().toISOString(), step, kind, detail: detail.slice(0, 300) })
  writeFileSync(file, JSON.stringify(existing, null, 2))
}
