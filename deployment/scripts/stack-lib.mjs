// Pure helpers for deployment/scripts/stack.mjs. No side effects here:
// every function takes observed facts and returns a verdict, so the
// whole module is unit-testable without docker (tests/backend/stack.test.ts).

/** Parse a KEY=value env file. Skips blanks/comments, strips quotes. */
export function parseEnvFile(text) {
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const key = line.slice(0, line.indexOf('=')).trim()
    let value = line.slice(line.indexOf('=') + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value
  }
  return out
}

/** Count tools in the TOOL_SCHEMAS map of backend/src/mcp/schemas.ts. */
export function countRepoTools(schemasTs) {
  const start = schemasTs.indexOf('export const TOOL_SCHEMAS = {')
  if (start < 0) throw new Error('TOOL_SCHEMAS block not found')
  const end = schemasTs.indexOf('\n}', start)
  const block = schemasTs.slice(start, end < 0 ? undefined : end)
  return block.split('\n').filter((line) => /^  '[^']+':/.test(line)).length
}

/**
 * One-fleet rule: every worker polls the same turn queue, so any two
 * pollers (compose+host or host+host) fail turns at random.
 * hostWorkers: [{ pid, user, cmd }]. Returns { level, detail, fix }.
 */
export function fleetVerdict({ hostWorkers, composeWorkerRunning }) {
  if (!composeWorkerRunning && hostWorkers.length === 0) {
    return { level: 'warn', detail: 'no worker fleet is polling (sends will stall)', fix: ['npm run stack:worker:compose   # start the compose fleet'] }
  }
  if (hostWorkers.length > 1) {
    const kills = hostWorkers.map((p) => `${p.user === 'root' ? 'sudo ' : ''}kill ${p.pid}  # ${p.cmd.slice(0, 60)}`)
    return {
      level: 'fail',
      detail: `duplicate fleet: ${hostWorkers.length} host workers poll the same queue${composeWorkerRunning ? ' (plus the compose worker)' : ''}`,
      fix: [...kills.slice(1), 'npm run stack:doctor   # re-check, then retry'],
    }
  }
  if (composeWorkerRunning && hostWorkers.length > 0) {
    const kills = hostWorkers.map((p) => `${p.user === 'root' ? 'sudo ' : ''}kill ${p.pid}  # ${p.cmd.slice(0, 60)}`)
    return {
      level: 'fail',
      detail: `duplicate fleet: compose worker + ${hostWorkers.length} host worker(s) poll the same queue`,
      fix: [...kills, 'npm run stack:doctor   # re-check, then retry'],
    }
  }
  const who = composeWorkerRunning ? 'compose worker' : `host worker (pid ${hostWorkers[0].pid})`
  return { level: 'pass', detail: `single fleet polling: ${who}`, fix: [] }
}

/**
 * Image freshness: the backend/worker images carry the source SHA they
 * were built from (org.kardata.git-sha label). Unknown (pre-label
 * images) warns; a mismatch fails.
 */
export function freshnessVerdict({ service, labelSha, headSha, headSubject }) {
  if (!labelSha || labelSha === 'unknown') {
    return { level: 'warn', detail: `${service} image predates SHA labels (staleness unknown)`, fix: ['npm run stack:deploy   # rebuild from current source'] }
  }
  if (labelSha === headSha) return { level: 'pass', detail: `${service} image matches HEAD ${headSha.slice(0, 9)}`, fix: [] }
  return {
    level: 'fail',
    detail: `${service} image built from ${labelSha.slice(0, 9)}, HEAD is ${headSha.slice(0, 9)} (${headSubject})`,
    fix: ['npm run stack:deploy   # rebuild from current source'],
  }
}

/** MCP parity: the wire must serve exactly the repo's tool count. */
export function parityVerdict({ served, repo }) {
  if (served === null) return { level: 'warn', detail: 'parity unchecked (no service key available)', fix: [] }
  if (served < 0) return { level: 'fail', detail: 'MCP unreachable (tools/list failed); is the backend up?', fix: ['npm run stack:status   # check backend health first'] }
  if (served === repo) return { level: 'pass', detail: `MCP serves ${served}/${repo} repo tools`, fix: [] }
  return { level: 'fail', detail: `MCP serves ${served} tools but the repo defines ${repo} (stale image)`, fix: ['npm run stack:deploy   # rebuild from current source'] }
}

/**
 * Owned test-process selection for `stack:clean`. A process is killed only
 * when all three hold: it runs as the caller, it sits under the repo root
 * (command path or working directory), and it has an owned test shape —
 * vite on the owned test ports (15173/15174) or a playwright/vitest worker.
 * Browsers and other-user matches are notes with kill hints, never
 * automatic kills; the owner's dev servers (5173/5174) never match.
 * processes: [{ pid, user, cwd, cmd }]. Returns { kill, notes }.
 */
export function ownedTestProcs(processes, { repoRoot, user }) {
  const kill = []
  const notes = []
  const hint = (proc) => `${proc.user === 'root' && user !== 'root' ? 'sudo ' : ''}kill ${proc.pid}  # ${proc.cmd.slice(0, 70)}`
  for (const proc of processes) {
    const underRepo = proc.cmd.includes(repoRoot) || proc.cwd === repoRoot || proc.cwd.startsWith(`${repoRoot}/`)
    const ownedShape =
      (/vite/.test(proc.cmd) && /1517[34]/.test(proc.cmd)) ||
      proc.cmd.includes('playwright/lib/worker') ||
      proc.cmd.includes('playwright-core/lib/worker') ||
      /\/vitest\//.test(proc.cmd)
    if (!underRepo || !ownedShape) {
      if (/chrome-headless-shell|chrome --headless/.test(proc.cmd)) {
        notes.push(`browser leftover pid ${proc.pid}: not auto-killed; $ ${hint(proc)}`)
      }
      continue
    }
    if (proc.user !== user) {
      notes.push(`owned test shape, other user (${proc.user}) pid ${proc.pid}: not auto-killed; $ ${hint(proc)}`)
      continue
    }
    kill.push(proc)
  }
  return { kill, notes }
}

/**
 * Refuse to delete the pilot archive (`var/pilot/archive`): runs are kept
 * forever, and no stack command may remove them. Throws on the archive or
 * anything inside it; allows everything else. Phase 8 wires this into
 * `pilot down`; until then it has no caller (knip baseline notes it).
 */
export function assertDeletablePath(target, { repoRoot }) {
  const resolved = target.startsWith('/') ? target : `${repoRoot}/${target}`
  const archive = `${repoRoot}/var/pilot/archive`
  if (resolved === archive || resolved.startsWith(`${archive}/`)) {
    throw new Error(`stack refuses to delete the pilot archive: ${target}`)
  }
}

/** Render one verdict line: [PASS|WARN|FAIL] detail (+ indented fix lines). */
export function formatVerdict(name, verdict) {
  const tag = verdict.level.toUpperCase().padEnd(4)
  const lines = [`[${tag}] ${name}: ${verdict.detail}`]
  for (const fix of verdict.fix) lines.push(`         $ ${fix}`)
  return lines.join('\n')
}
