// No hardcoded staging values in backend source. Hosts, ports, and key
// names resolve from environment; the only literals allowed are documented
// dev defaults behind an env override (exact file + line, so anything new
// fails loudly instead of slipping into a staging build).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..', 'backend', 'src')
const STAGING_LITERAL = /localhost|127\.0\.0\.1|demo-operator|demo-viewer/

// Each entry is the single documented exception in that file:
// TEMPORAL_ADDRESS falls back to a local Temporal, CORS origins fall back
// to the local vite dev server (both overridden by environment), the web
// blocklist denies 'localhost' as an SSRF guard (not a staging default),
// and the browser sidecar discovery sends a loopback Host header to pass
// Chrome's DNS-rebinding guard (the TCP target stays the CDP URL).
const ALLOW_LIST: Array<{ file: string; literal: string }> = [
  { file: join('temporal', 'connection.ts'), literal: 'localhost:7233' },
  { file: join('http', 'cors.ts'), literal: 'http://localhost:5173' },
  { file: join('http', 'cors.ts'), literal: 'http://127.0.0.1:5173' },
  { file: join('retrieval', 'web.ts'), literal: `hostname === 'localhost'` },
  { file: join('retrieval', 'web.ts'), literal: `hostname.endsWith('.localhost')` },
  { file: join('retrieval', 'browser.ts'), literal: '`127.0.0.1:' },
]

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? textFiles(full) : [full]
  })
}

describe('no hardcoded staging values in backend source', () => {
  it('fails on unlisted localhost or demo key names under backend/src', () => {
    const offenders: string[] = []
    for (const file of textFiles(SRC)) {
      const content = readFileSync(file, 'utf8')
      if (!STAGING_LITERAL.test(content)) continue
      const relative = file.slice(SRC.length + 1)
      const allowed = ALLOW_LIST.filter((entry) => entry.file === relative).map(
        (entry) => entry.literal,
      )
      const stripped = allowed.reduce(
        (text, literal) => text.split(literal).join(''),
        content,
      )
      if (STAGING_LITERAL.test(stripped)) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })
})
