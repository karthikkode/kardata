// Seams expose real hooks (P6-M3): the converted data/use*.ts files must
// not re-export api values, and the migrated consumers must not import
// the old raw names. The eslint ban enforces this at lint time; this
// test pins it at test time. Excepted seams (useThreads, useFiles,
// useApi) are listed in frontend/eslint.config.js with reasons.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..')
const DATA = join(ROOT, 'frontend', 'src', 'data')
const COMPONENTS = join(ROOT, 'frontend', 'src', 'components')

const CONVERTED_SEAMS = ['useRuns.ts', 'useModels.ts', 'useSessions.ts', 'useSkills.ts']
const RAW_NAMES = [
  'listRuns', 'cancelRun', 'pauseRun', 'resumeRun', 'setSessionModel', 'getSession',
  'listSessions', 'compactSession', 'createSession', 'deleteSession', 'renameSession', 'listSkills',
]
const MIGRATED_CONSUMERS = [
  'RunsPanel.tsx', 'ModelsPanel.tsx', 'ModelToolbar.tsx', 'ChatPanel.tsx', join('chat', 'useChatSync.ts'),
]

function valueReexports(text: string): string[] {
  return text
    .split('\n')
    .filter(
      (line) =>
        /^\s*export\s*\{[^}]*\}\s*from\s*['"]\.\/api\//.test(line) && !/^\s*export\s+type\s*\{/.test(line),
    )
}

describe('hooks seam gate (P6-M3)', () => {
  it('converted seams re-export no api values', () => {
    for (const seam of CONVERTED_SEAMS) {
      const text = readFileSync(join(DATA, seam), 'utf8')
      expect(valueReexports(text), seam).toEqual([])
      expect(text, `${seam} re-exports no api barrel`).not.toMatch(/export \* from '\.\/api\//)
      expect(text, `${seam} exposes hooks`).toMatch(/export function use\w+/)
    }
  })

  it('migrated consumers import hooks, not raw api names', () => {
    for (const consumer of MIGRATED_CONSUMERS) {
      const source = readFileSync(join(COMPONENTS, consumer), 'utf8')
      for (const line of source.split('\n')) {
        if (!/^import .* from '\.\.(\/\.\.)?\/data\/use(Runs|Models|Sessions|Skills)'/.test(line)) continue
        for (const name of RAW_NAMES) {
          expect(line, `${consumer}: raw ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`))
        }
      }
    }
  })
})
