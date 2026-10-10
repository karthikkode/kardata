// Pilot occurrence log (F8c): every nudge, reload recovery, resume or
// re-pick a spec performs lands in the run's occurrences.json, so r1
// workarounds show as occurrences instead of hiding product issues.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logOccurrence } from '../frontend-e2e/pilot/state.js'

describe('pilot occurrence log (F8c)', () => {
  let worktree = ''
  afterEach(() => {
    vi.unstubAllEnvs()
    if (worktree) rmSync(worktree, { recursive: true, force: true })
    worktree = ''
  })

  it('appends occurrences to the run log in order', () => {
    worktree = mkdtempSync(join(tmpdir(), 'pilot-occ-'))
    vi.stubEnv('KARDATA_PILOT_TAG', 'occ-test')
    vi.stubEnv('KARDATA_PILOT_WORKTREE', worktree)
    logOccurrence('p2-brainstorm', 'nudge', 'chat icp idle, nudge 1/2')
    logOccurrence('p3-context', 'resume', 'paused banner after crashed turn')
    const file = join(worktree, 'var', 'pilot', 'run-occ-test', 'occurrences.json')
    const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<{ step: string; kind: string; detail: string; at: string }>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ step: 'p2-brainstorm', kind: 'nudge', detail: 'chat icp idle, nudge 1/2' })
    expect(rows[1]).toMatchObject({ step: 'p3-context', kind: 'resume' })
    expect(rows[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
