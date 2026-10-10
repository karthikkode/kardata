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

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}
