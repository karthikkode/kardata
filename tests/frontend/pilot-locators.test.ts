// P8-B3: every string literal a pilot spec locates by must resolve to
// frontend/src or the verified v2 corpus — never from memory. Regex,
// template, and variable locators skip (dynamic by construction); the
// pinned allowlist covers spec-composed strings whose SHAPE is
// verified in the cited component (r0 shakes out live behavior).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PILOT = join(ROOT, 'tests', 'frontend-e2e', 'pilot')

// literal -> why it is not in frontend/src verbatim.
const ALLOWLIST: Record<string, string> = {
  'Close Context history': 'shape `Close ${title}` (workspace-parts WorkspaceOverlay) + P3 history',
  'Close Files and global context': 'shape `Close ${title}` (workspace-parts WorkspaceOverlay) + P3 rail',
  'Close Review context update': 'shape `Close ${title}` (workspace-parts WorkspaceOverlay) + P3 review',
  'Move pilot-p7-queued-b up': 'shape `Move ${text} up` (SectorWorkspace QueueRowBody) + P7 data',
  'Open Research': 'shape `Open ${title}` (SectorWorkspace session rail) + research session',
  'Open pilot-geo': 'shape `Open ${title}` (SectorWorkspace session rail) + P2 rename',
  'Open pilot-icp': 'shape `Open ${title}` (SectorWorkspace session rail) + P2 rename',
  'Open pilot-sources': 'shape `Open ${title}` (SectorWorkspace session rail) + P2 rename',
  'Open pilot-research': 'shape `Open ${title}` (SectorWorkspace session rail) + P5 rename',
  'Queued (1)': 'shape `Queued (${n})` (SectorWorkspace QueueDisclosure)',
  'Queued (2)': 'shape `Queued (${n})` (SectorWorkspace QueueDisclosure)',
  'Remove market-notes.md from global context': 'shape `Remove ${f} from global context` (workspace-files) + P2 upload',
  'Remove pilot-p7-queued-a': 'shape `Remove ${text}` (SectorWorkspace QueueRowBody) + P7 data',
  'market-notes.md': 'P2 uploads this fixture',
  'report.pdf': 'P2 uploads this fixture',
  'suburbs-100.md': 'tier-100 writes this file',
  'suburbs-1000.md': 'tier-1000 writes this file',
}

function readTree(dir: string): string {
  let out = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__ban-fixtures__') continue
      out += readTree(path)
    } else if (/\.(ts|tsx|js|mjs|css)$/.test(entry.name)) {
      out += `\n${readFileSync(path, 'utf8')}`
    }
  }
  return out
}

function specLiterals(source: string): string[] {
  const found = new Set<string>()
  for (const pattern of [
    /getBy(?:Text|Label|Placeholder|TestId|Title)\(\s*'([^']+)'/g,
    /{ name: '([^']+)'/g,
    /:has-text\("([^"]+)"\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) found.add(match[1]!)
  }
  return [...found]
}

describe('pilot spec locators resolve to product or v2 [F:pilot.locators]', () => {
  it('every locator literal exists in frontend/src, v2, or the allowlist', () => {
    const src = readTree(join(ROOT, 'frontend', 'src'))
    const v2 = readTree(join(ROOT, 'tests', 'frontend-e2e', 'v2'))
    const missing: string[] = []
    const files = readdirSync(PILOT).filter((name) => name.endsWith('.spec.ts') || name === 'record.ts')
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      for (const literal of specLiterals(readFileSync(join(PILOT, file), 'utf8'))) {
        if (literal in ALLOWLIST) continue
        if (!src.includes(literal) && !v2.includes(literal)) missing.push(`${file}: ${literal}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('the allowlist stays pinned (no silent growth)', () => {
    expect(Object.keys(ALLOWLIST).sort()).toEqual([
      'Close Context history',
      'Close Files and global context',
      'Close Review context update',
      'Move pilot-p7-queued-b up',
      'Open Research',
      'Open pilot-geo',
      'Open pilot-icp',
      'Open pilot-research',
      'Open pilot-sources',
      'Queued (1)',
      'Queued (2)',
      'Remove market-notes.md from global context',
      'Remove pilot-p7-queued-a',
      'market-notes.md',
      'report.pdf',
      'suburbs-100.md',
      'suburbs-1000.md',
    ])
  })
})
