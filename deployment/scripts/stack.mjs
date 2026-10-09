#!/usr/bin/env node
// One-command local platform: `npm run stack:<up|down|deploy|status|doctor|worker:host|worker:compose>`.
// Compose-first: the compose stack owns the runtime; the host worker path
// exists for laptop dev and can never run alongside the compose worker.
// Verdict logic lives in stack-lib.mjs (pure, unit-tested); this file only
// gathers facts (docker, git, curl) and acts on them.
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readlinkSync } from 'node:fs'
import { countRepoTools, fleetVerdict, formatVerdict, freshnessVerdict, ownedTestProcs, parityVerdict, parseEnvFile, portsDisjointVerdict, RESOURCE_PROFILES } from './stack-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const COMPOSE = join(HERE, '..', 'compose.yaml')
const PG_PORT = process.env['KARDATA_PG_PORT'] ?? '5433'
const BACKEND_URL = 'http://127.0.0.1:3001'
// App services boot by default. OBS_SERVICES (temporal-ui, telemetry)
// stay opt-in via `stack:obs`: on machines where a second stack
// (e.g. preflight) already holds 3000/3100/8080/9090 they cannot bind.
const APP_SERVICES = ['db', 'temporal', 'browser', 'backend', 'worker']
const OBS_SERVICES = ['temporal-ui', 'loki', 'promtail', 'prometheus', 'grafana']

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

function composeEnv() {
  return { ...process.env, KARDATA_PG_PORT: PG_PORT, GIT_SHA: gitHead().sha }
}

function gitHead() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ROOT, encoding: 'utf8' }).trim()
    return { sha, subject }
  } catch { return { sha: 'unknown', subject: '' } }
}

async function composePs() {
  const out = await run('docker', ['compose', '-f', COMPOSE, 'ps', '--format', 'json'], { env: composeEnv() })
  if (!out.ok) return []
  const text = out.stdout.trim()
  if (!text) return []
  try {
    // --format json prints one object per line (or a single array on old versions).
    return text.startsWith('[') ? JSON.parse(text) : text.split('\n').map((line) => JSON.parse(line))
  } catch { return [] }
}

/** Host processes matching a pgrep pattern, with owner, cwd, and command. */
async function hostStackProcs(pattern = 'backend/dist/server\\.js|dev-worker\\.js') {
  const out = await run('pgrep', ['-af', pattern])
  if (!out.ok) return []
  const procs = []
  for (const line of out.stdout.split('\n')) {
    const match = line.match(/^(\d+)\s+(.*)$/)
    if (!match || line.includes('pgrep -af')) continue
    const pid = match[1]
    let user = ''
    const userOut = await run('ps', ['-o', 'user=', '-p', pid])
    if (userOut.ok) user = userOut.stdout.trim()
    let cwd = ''
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`)
    } catch { cwd = '' }
    procs.push({ pid, user, cwd, cmd: match[2] })
  }
  return procs
}

function isWorkerCmd(cmd) {
  return cmd.includes('dev-worker')
}

async function imageLabelSha(service) {
  const ps = await composePs()
  const svc = ps.find((s) => s.Service === service)
  const image = svc?.Image
  if (!image) return null
  const out = await run('docker', ['image', 'inspect', '--format', '{{index .Config.Labels "org.kardata.git-sha"}}', image])
  if (!out.ok) return null
  const sha = out.stdout.trim()
  return sha && sha !== '<no value>' ? sha : null
}

async function waitFor(label, check, timeoutMs = 120_000) {
  const start = Date.now()
  for (;;) {
    if (await check()) return true
    if (Date.now() - start > timeoutMs) {
      console.error(`stack: timed out waiting for ${label}`)
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

/** Probe fetch that always settles: a bare fetch can pend forever
 * without keeping the loop alive (observed: socket dropped during the
 * docker-proxy handoff while a backend recreates — the AbortSignal
 * timeout never fires, the loop drains, node exits 13 silently). The
 * ref'd timer below both forces settlement and keeps the loop alive. */
async function probeFetch(url, options = {}, ms = 8000) {
  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('probe timeout')), ms)
    })
    return await Promise.race([fetch(url, options), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function backendHealthy() {
  try {
    const response = await probeFetch(`${BACKEND_URL}/healthz`, { signal: AbortSignal.timeout(5000) })
    const body = await response.json()
    return response.ok && body?.ok === true
  } catch { return false }
}

async function containerLogHas(container, needle, since = null) {
  const args = since ? ['logs', '--since', since, container] : ['logs', '--tail', '200', container]
  const out = await run('docker', args)
  return `${out.stdout}\n${out.stderr}`.includes(needle)
}

async function containerName(service) {
  const ps = await composePs()
  return ps.find((s) => s.Service === service)?.Name ?? `kardata-${service}-1`
}

function readKey(envPath, key) {
  if (!existsSync(envPath)) return null
  const value = parseEnvFile(readFileSync(envPath, 'utf8'))[key]
  return value || null
}

async function servedToolCount(backendUrl = BACKEND_URL, apiKey = readKey(join(ROOT, 'frontend', '.env'), 'VITE_STAGING_KEY')) {
  if (!apiKey) return null
  try {
    const response = await probeFetch(`${backendUrl}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(15000),
    }, 20000)
    const body = await response.json()
    const tools = body?.result?.tools
    return Array.isArray(tools) ? tools.length : -1
  } catch { return -1 }
}

function repoToolCount() {
  return countRepoTools(readFileSync(join(ROOT, 'backend', 'src', 'mcp', 'schemas.ts'), 'utf8'))
}

async function cmdUp() {
  const out = await run('docker', ['compose', '-f', COMPOSE, 'up', '-d', ...APP_SERVICES], { env: composeEnv() })
  process.stdout.write(out.stdout || out.stderr)
  if (!out.ok) process.exit(1)
  console.log('stack: up (images unchanged; use stack:deploy after a repo move; stack:obs adds telemetry)')
}

async function cmdObs() {
  const out = await run('docker', ['compose', '-f', COMPOSE, 'up', '-d', ...OBS_SERVICES], { env: composeEnv() })
  process.stdout.write(out.stdout || out.stderr)
  if (!out.ok) {
    console.error('stack: observability failed to bind (another stack may hold 3000/3100/8080/9090)')
    process.exit(1)
  }
}

async function cmdDown() {
  // Never `down -v`: volumes hold the database and demo keys.
  const out = await run('docker', ['compose', '-f', COMPOSE, 'down'], { env: composeEnv() })
  process.stdout.write(out.stdout || out.stderr)
  if (!out.ok) process.exit(1)
}

async function cmdDeploy() {
  const head = gitHead()
  console.log(`stack: deploying backend+worker from ${head.sha.slice(0, 9)} (${head.subject})`)
  const build = await run('docker', ['compose', '-f', COMPOSE, 'build', 'backend', 'worker'], { env: composeEnv() })
  process.stdout.write(build.stdout || build.stderr)
  if (!build.ok) process.exit(1)
  const up = await run('docker', ['compose', '-f', COMPOSE, 'up', '-d', ...APP_SERVICES], { env: composeEnv() })
  process.stdout.write(up.stdout || up.stderr)
  if (!up.ok) process.exit(1)
  const worker = await containerName('worker')
  const backend = await containerName('backend')
  const okBackend = await waitFor('backend /healthz', backendHealthy)
  const okWorker = await waitFor('worker polling', () => containerLogHas(worker, 'turn worker polling'))
  if (!okBackend || !okWorker) process.exit(1)
  if (await containerLogHas(worker, '[FATAL]')) {
    console.error(`stack: worker reports [FATAL] (usually a stale MCP credential); see: docker logs ${worker}`)
    process.exit(1)
  }
  if (await containerLogHas(backend, '[FATAL]')) {
    console.error(`stack: backend reports [FATAL]; see: docker logs ${backend}`)
    process.exit(1)
  }
  const served = await servedToolCount()
  const repo = repoToolCount()
  const parity = parityVerdict({ served, repo })
  console.log(formatVerdict('mcp-parity', parity))
  if (parity.level === 'fail') process.exit(1)
  console.log('stack: deploy green')
}

async function cmdStatus() {
  const head = gitHead()
  console.log(`HEAD ${head.sha.slice(0, 9)} (${head.subject})   KARDATA_PG_PORT=${PG_PORT}`)
  const ps = await composePs()
  if (ps.length === 0) console.log('(compose stack is down)')
  for (const svc of ps) console.log(`- ${svc.Service}: ${svc.State} (${svc.Status ?? ''})`.trim())
  for (const service of ['backend', 'worker']) {
    console.log(formatVerdict(service, freshnessVerdict({ service, labelSha: await imageLabelSha(service), headSha: head.sha, headSubject: head.subject })))
  }
  console.log(`backend /healthz: ${await backendHealthy() ? 'ok' : 'unreachable'}`)
}

async function cmdDoctor() {
  const head = gitHead()
  const procs = await hostStackProcs()
  const ps = await composePs()
  const composeWorkerRunning = ps.some((s) => s.Service === 'worker' && s.State === 'running')
  const verdicts = [
    ['fleet', fleetVerdict({ hostWorkers: procs.filter((p) => isWorkerCmd(p.cmd)), composeWorkerRunning })],
    ['backend-image', freshnessVerdict({ service: 'backend', labelSha: await imageLabelSha('backend'), headSha: head.sha, headSubject: head.subject })],
    ['worker-image', freshnessVerdict({ service: 'worker', labelSha: await imageLabelSha('worker'), headSha: head.sha, headSubject: head.subject })],
    ['mcp-parity', parityVerdict({ served: await servedToolCount(), repo: repoToolCount() })],
    ['ports-disjoint', portsDisjointVerdict({})],
  ]
  if (!existsSync(join(PROD_DIR, 'deployment', 'compose.yaml'))) {
    verdicts.push(['prod', { level: 'warn', detail: `prod dir missing at ${PROD_DIR}`, fix: [`git worktree add ${PROD_DIR} prod   # runbook bootstrap`] }])
  } else {
    const release = originProdSha()
    for (const service of ['backend', 'worker', 'ui']) {
      verdicts.push([`prod/${service}`, prodFreshnessVerdict({ service, labelSha: await prodImageLabelSha(service), releaseSha: release })])
    }
    const prodWorkers = (await prodPs()).filter((s) => s.Service === 'worker' && s.State === 'running').length
    verdicts.push(['prod-fleet', prodWorkers > 0
      ? { level: 'pass', detail: `prod fleet polling: ${prodWorkers} compose worker(s)`, fix: [] }
      : { level: 'warn', detail: 'prod stack is down (volumes kept)', fix: ['npm run stack:prod -- up   # restore prod'] }])
  }
  let failed = false
  for (const [name, verdict] of verdicts) {
    console.log(formatVerdict(name, verdict))
    if (verdict.level === 'fail') failed = true
  }
  const spareServers = procs.filter((p) => !isWorkerCmd(p.cmd))
  for (const spare of spareServers) {
    console.log(`[INFO] host backend pid ${spare.pid} (${spare.user || 'unknown user'}): harmless spare on its own port; stop it if unused: ${spare.user === 'root' ? 'sudo ' : ''}kill ${spare.pid}`)
  }
  if (!existsSync(join(ROOT, 'agents', '.env'))) {
    console.log('[WARN] env: agents/.env missing (provider keys + KARDATA_MCP_TOKEN live there)')
  }
  process.exit(failed ? 1 : 0)
}

async function cmdWorkerHost() {
  // Mutual exclusion both ways: refuse while a host worker already polls,
  // and stop the compose worker before the host one starts, so two
  // pollers can never double-poll the turn queue.
  const procs = (await hostStackProcs()).filter((p) => isWorkerCmd(p.cmd))
  if (procs.length > 0) {
    console.error('stack: refusing to start a second host worker (one already polls):')
    for (const p of procs) console.error(`  $ ${p.user === 'root' ? 'sudo ' : ''}kill ${p.pid}  # ${p.cmd.slice(0, 70)}`)
    process.exit(1)
  }
  await run('docker', ['compose', '-f', COMPOSE, 'stop', 'worker'], { env: composeEnv() })
  const envFile = join(ROOT, 'agents', '.env')
  const fileEnv = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {}
  const env = {
    ...process.env,
    ...fileEnv,
    DATABASE_URL: process.env['DATABASE_URL'] ?? fileEnv['DATABASE_URL'] ?? `postgresql://kardata:kardata-dev@127.0.0.1:${PG_PORT}/kardata`,
    TEMPORAL_ADDRESS: process.env['TEMPORAL_ADDRESS'] ?? fileEnv['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
    KARDATA_MCP_URL: process.env['KARDATA_MCP_URL'] ?? fileEnv['KARDATA_MCP_URL'] ?? 'http://127.0.0.1:3001/mcp',
  }
  console.log('stack: compose worker stopped; starting host worker (Ctrl-C to stop, then run stack:worker:compose)')
  const child = spawn('node', ['backend/dist/temporal/dev-worker.js'], { cwd: ROOT, env, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
}

async function cmdWorkerCompose() {
  // Never kill user processes automatically: refuse and print the fix.
  const procs = (await hostStackProcs()).filter((p) => isWorkerCmd(p.cmd))
  if (procs.length > 0) {
    console.error('stack: refusing to start the compose worker: host worker(s) already polling:')
    for (const p of procs) console.error(`  $ ${p.user === 'root' ? 'sudo ' : ''}kill ${p.pid}  # ${p.cmd.slice(0, 70)}`)
    process.exit(1)
  }
  const out = await run('docker', ['compose', '-f', COMPOSE, 'up', '-d', 'worker'], { env: composeEnv() })
  process.stdout.write(out.stdout || out.stderr)
  if (!out.ok) process.exit(1)
  const ok = await waitFor('worker polling', async () => containerLogHas(await containerName('worker'), 'turn worker polling'))
  if (!ok) process.exit(1)
  console.log('stack: compose worker polling')
}

async function cmdWorker(args) {
  // Compose replica scaling: every replica polls the same lanes, and the
  // Meta permit table caps the fleet. Cap 16: 16 workers x 5 PG
  // connections + server pool stays inside a 100-connection budget.
  let replicas = 1
  const flag = args.indexOf('--replicas')
  if (flag >= 0) {
    replicas = Number(args[flag + 1])
    if (!Number.isInteger(replicas) || replicas < 1 || replicas > 16) {
      console.error('stack: --replicas must be an integer from 1 to 16')
      process.exit(1)
    }
  }
  const procs = (await hostStackProcs()).filter((p) => isWorkerCmd(p.cmd))
  if (procs.length > 0) {
    console.error('stack: refusing to scale the compose worker: host worker(s) already polling:')
    for (const p of procs) console.error(`  $ ${p.user === 'root' ? 'sudo ' : ''}kill ${p.pid}  # ${p.cmd.slice(0, 70)}`)
    process.exit(1)
  }
  // The fleet pool check reads this: backend and worker validate
  // server + worker x replicas against max_connections at boot.
  process.env.KARDATA_WORKER_REPLICAS = String(replicas)
  const out = await run('docker', ['compose', '-f', COMPOSE, 'up', '-d', '--scale', `worker=${replicas}`, 'worker'], { env: composeEnv() })
  process.stdout.write(out.stdout || out.stderr)
  if (!out.ok) process.exit(1)
  const ok = await waitFor(`${replicas} worker(s) polling`, async () => {
    const names = (await composePs())
      .filter((s) => s.Service === 'worker' && s.State === 'running')
      .map((s) => s.Name)
    if (names.length < replicas) return false
    for (const name of names) {
      if (!(await containerLogHas(name, 'turn worker polling'))) return false
    }
    return true
  })
  if (!ok) process.exit(1)
  console.log(`stack: ${replicas} compose worker(s) polling`)
}

async function cmdClean() {
  // Recorded live-stack PIDs first (provably owned), then owned test
  // servers/workers only. Browsers, foreign checkouts, other users, and
  // the owner's dev servers are notes with kill hints, never auto-kills.
  const stop = await run('bash', [join(ROOT, 'scripts', 'live-stack-stop.sh')])
  process.stdout.write(stop.stdout || stop.stderr)
  const meOut = await run('whoami', [])
  const me = meOut.stdout.trim()
  const procs = await hostStackProcs('vite|playwright|chrome-headless-shell')
  const { kill, notes } = ownedTestProcs(procs, { repoRoot: ROOT, user: me })
  for (const proc of kill) {
    try {
      process.kill(Number(proc.pid), 'SIGTERM')
    } catch { /* already gone */ }
  }
  if (kill.length > 0) await new Promise((resolve) => setTimeout(resolve, 2000))
  let stopped = 0
  for (const proc of kill) {
    try {
      process.kill(Number(proc.pid), 0)
      try {
        process.kill(Number(proc.pid), 'SIGKILL')
      } catch { /* raced out */ }
      stopped += 1
    } catch {
      stopped += 1 // SIGTERM already reaped it
    }
  }
  for (const note of notes) console.log(`[INFO] ${note}`)
  console.log(`stack: clean stopped ${stopped} owned test process(es)`)
}

async function cmdToxi(args) {
  const [sub] = args
  if (sub === 'up') {
    const existing = await run('docker', ['inspect', '-f', '{{.State.Running}}', 'kardata-toxiproxy'])
    if (existing.ok && existing.stdout.trim() === 'true') {
      console.log('stack: toxiproxy already running (127.0.0.1:8474)')
      return
    }
    if (existing.ok) await run('docker', ['rm', '-f', 'kardata-toxiproxy'])
    const created = await run('docker', ['run', '-d', '--name', 'kardata-toxiproxy', '--network', 'host', 'shopify/toxiproxy@sha256:a6b080af39986b863a1f7c5a3b9bacf2afeb48abab8f0eb7e243f8f7ad38c645'])
    process.stdout.write(created.stdout || created.stderr)
    if (!created.ok) process.exit(1)
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('http://127.0.0.1:8474/version')
        if (res.ok) {
          console.log('stack: toxiproxy up (127.0.0.1:8474)')
          return
        }
      } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    console.error('stack: toxiproxy did not answer on 127.0.0.1:8474')
    process.exit(1)
  }
  if (sub === 'down') {
    const existing = await run('docker', ['inspect', '-f', '{{.State.Running}}', 'kardata-toxiproxy'])
    if (!existing.ok) {
      console.log('stack: toxiproxy not present')
      return
    }
    const removed = await run('docker', ['rm', '-f', 'kardata-toxiproxy'])
    process.stdout.write(removed.stdout || removed.stderr)
    if (!removed.ok) process.exit(1)
    return
  }
  console.error('usage: npm run stack:toxi -- <up|down>')
  process.exit(1)
}

// ---- prod / release / resources (Phase 3) ----
// Prod runs from a sibling worktree pinned to origin/prod; this script
// drives it (no second script). Prod has its own Temporal + Postgres,
// so cross-env worker stealing is impossible by topology: the one-fleet
// rule applies per env, never across envs.
const PROD_DIR = process.env['KARDATA_PROD_DIR'] ?? join(ROOT, '..', 'kardata_prod')
const PROD_PROJECT = 'kardata-prod'
const PROD_BACKEND_URL = 'http://127.0.0.1:4001'
const PROD_UI_URL = 'http://127.0.0.1:45174'
const PROD_APP_SERVICES = ['db', 'temporal', 'browser', 'backend', 'worker']
const PROD_OBS_SERVICES = ['temporal-ui', 'loki', 'promtail', 'prometheus', 'grafana']

function prodUiKey() {
  if (process.env['KARDATA_UI_KEY']) return process.env['KARDATA_UI_KEY']
  const keyFile = join(PROD_DIR, 'agents', '.env')
  if (existsSync(keyFile)) return parseEnvFile(readFileSync(keyFile, 'utf8'))['KARDATA_UI_KEY'] ?? null
  return null
}

function prodComposeFiles() {
  const base = join(PROD_DIR, 'deployment', 'compose.yaml')
  const released = join(PROD_DIR, 'deployment', 'compose.prod.yaml')
  const files = existsSync(released)
    ? ['-f', base, '-f', released]
    : (console.log('stack: WARN prod overlay not yet released; using staging copy (bootstrap mode)'),
      ['-f', base, '-f', join(HERE, '..', 'compose.prod.yaml')])
  // The UI overlay carries a required build arg: include it only when
  // the key exists, so keyless commands (status, up, keyless deploy)
  // still load the config.
  if (prodUiKey()) {
    const uiReleased = join(PROD_DIR, 'deployment', 'compose.prod.ui.yaml')
    files.push('-f', existsSync(uiReleased) ? uiReleased : join(HERE, '..', 'compose.prod.ui.yaml'))
  }
  return files
}

function requireProdDir() {
  if (!existsSync(join(PROD_DIR, 'deployment', 'compose.yaml'))) {
    console.error(`stack: prod dir missing at ${PROD_DIR} (runbook bootstrap: git worktree add ${PROD_DIR} prod)`)
    process.exit(1)
  }
}

function originProdSha() {
  try {
    return execFileSync('git', ['rev-parse', 'origin/prod'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch { return null }
}

function prodWorktreeSha() {
  try {
    return execFileSync('git', ['-C', PROD_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch { return null }
}

function profileOf(args, fallback) {
  const flag = args.indexOf('--profile')
  const level = flag >= 0 ? args[flag + 1] : fallback
  if (level !== 'lean' && level !== 'full') {
    console.error(`stack: --profile must be lean|full, got '${level}'`)
    process.exit(1)
  }
  return level
}

function profileEnv(level) {
  const profile = RESOURCE_PROFILES[level]
  return {
    KARDATA_DB_POOL_SERVER: String(profile.dbPoolServer),
    KARDATA_DB_POOL_WORKER: String(profile.dbPoolWorker),
    KARDATA_META_MAX_CONCURRENT: String(profile.metaMaxConcurrent),
    KARDATA_BROWSER_MAX: String(profile.browserMax),
    KARDATA_WORKER_REPLICAS: String(profile.workerReplicas),
  }
}

function prodEnv(level) {
  const env = {
    ...process.env,
    KARDATA_STAGING_DIR: ROOT,
    KARDATA_PROD_DIR: PROD_DIR,
    GIT_SHA: prodWorktreeSha() ?? 'unknown',
    ...profileEnv(level),
  }
  const uiKey = prodUiKey()
  if (uiKey) env['KARDATA_UI_KEY'] = uiKey
  return env
}

async function prodCompose(args, level = 'full') {
  return run('docker', ['compose', '-p', PROD_PROJECT, ...prodComposeFiles(), ...args], { cwd: PROD_DIR, env: prodEnv(level) })
}

async function prodPs() {
  const out = await prodCompose(['ps', '--format', 'json'])
  if (!out.ok) return []
  const text = out.stdout.trim()
  if (!text) return []
  try {
    return text.startsWith('[') ? JSON.parse(text) : text.split('\n').map((line) => JSON.parse(line))
  } catch { return [] }
}

async function prodImageLabelSha(service) {
  const ps = await prodPs()
  const image = ps.find((s) => s.Service === service)?.Image
  if (!image) return null
  const out = await run('docker', ['image', 'inspect', '--format', '{{index .Config.Labels "org.kardata.git-sha"}}', image])
  if (!out.ok) return null
  const sha = out.stdout.trim()
  return sha && sha !== '<no value>' ? sha : null
}

async function urlHealthy(url) {
  try {
    const response = await probeFetch(url, { signal: AbortSignal.timeout(5000) })
    if (url.endsWith('/healthz') && !url.includes('45174')) {
      const body = await response.json()
      return response.ok && body?.ok === true
    }
    return response.ok
  } catch { return false }
}

function prodFreshnessVerdict({ service, labelSha, releaseSha }) {
  if (!releaseSha) return { level: 'warn', detail: `prod/${service}: origin/prod unknown (fetch first)`, fix: [] }
  const verdict = freshnessVerdict({ service: `prod/${service}`, labelSha, headSha: releaseSha, headSubject: 'origin/prod' })
  return { ...verdict, fix: verdict.fix.map((f) => f.replace('stack:deploy', 'stack:prod deploy')) }
}

async function prodImagePresent(service) {
  const out = await run('docker', ['image', 'inspect', `${PROD_PROJECT}-${service}`])
  return out.ok
}

async function cmdProdUp(args) {
  requireProdDir()
  const level = profileOf(args, 'full')
  const replicas = RESOURCE_PROFILES[level].workerReplicas
  const services = [...PROD_APP_SERVICES, ...PROD_OBS_SERVICES]
  if (await prodImagePresent('ui')) services.push('ui')
  else console.log('stack: WARN no prod UI image; boot it with stack:prod deploy once KARDATA_UI_KEY exists')
  const out = await prodCompose(['up', '-d', '--scale', `worker=${replicas}`, ...services], level)
  process.stdout.write(out.stdout || out.stderr)
  if (!out.ok) process.exit(1)
  console.log(`stack: prod up (${level}, worker x${replicas})`)
}

async function cmdProdDown() {
  requireProdDir()
  // Never `down -v`: volumes hold the prod database and owner keys.
  const out = await prodCompose(['down'])
  process.stdout.write(out.stdout || out.stderr)
  if (!out.ok) process.exit(1)
  console.log('stack: prod down (volumes kept)')
}

async function cmdProdStatus() {
  requireProdDir()
  const release = originProdSha()
  const head = prodWorktreeSha()
  console.log(`origin/prod ${release?.slice(0, 9) ?? 'unknown'}   prod dir ${head?.slice(0, 9) ?? 'unknown'}${release && head ? (release === head ? ' (match)' : ' (DRIFT: deploy to fix)') : ''}`)
  const ps = await prodPs()
  if (ps.length === 0) console.log('(prod stack is down)')
  for (const svc of ps) console.log(`- ${svc.Service}: ${svc.State} (${svc.Status ?? ''})`.trim())
  for (const service of ['backend', 'worker', 'ui']) {
    console.log(formatVerdict(service, prodFreshnessVerdict({ service, labelSha: await prodImageLabelSha(service), releaseSha: release })))
  }
  console.log(`prod /healthz: ${await urlHealthy(`${PROD_BACKEND_URL}/healthz`) ? 'ok' : 'unreachable'}`)
  console.log(`prod ui: ${await urlHealthy(`${PROD_UI_URL}/healthz`) ? 'ok' : 'unreachable (key missing or not deployed)'}`)
}

async function cmdProdBackup() {
  requireProdDir()
  const ps = await prodPs()
  const db = ps.find((s) => s.Service === 'db' && s.State === 'running')
  if (!db) {
    console.log('stack: prod db is not running; nothing to back up (first deploy?)')
    return false
  }
  const dir = join(PROD_DIR, 'var', 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `prod-${stamp}.sql`)
  const dump = await run(
    'docker',
    ['compose', '-p', PROD_PROJECT, ...prodComposeFiles(), 'exec', '-T', '-e', 'PGPASSWORD=kardata-dev', 'db', 'pg_dump', '-U', 'kardata', 'kardata_prod'],
    { cwd: PROD_DIR, env: prodEnv('full'), maxBuffer: 512 * 1024 * 1024 },
  )
  if (!dump.ok || !dump.stdout) {
    console.error(`stack: backup failed${dump.stderr ? `: ${dump.stderr.slice(0, 200)}` : ''}`)
    return false
  }
  writeFileSync(file, dump.stdout)
  console.log(`stack: prod backup ${file} (${dump.stdout.length} bytes)`)
  console.log(`restore: docker compose -p ${PROD_PROJECT} exec -T db psql -U kardata kardata_prod < ${file}`)
  return true
}

/** The exact secret a prod container sees: prod agents/.env wins,
 * staging agents/.env is the fallback (compose env_file order). */
function prodSecret(name) {
  for (const file of [join(PROD_DIR, 'agents', '.env'), join(ROOT, 'agents', '.env')]) {
    const value = readKey(file, name)
    if (value) return value
  }
  return null
}

async function cmdProdProvisionKeys() {
  requireProdDir()
  // Values stay in this process: hashed locally, only keyIds printed.
  // Same pattern as scripts/live-stack.sh (hash-then-insert, no plaintext).
  const workerKey = prodSecret('KARDATA_MCP_TOKEN')
  const ownerKey = prodSecret('KARDATA_UI_KEY')
  if (!workerKey) {
    console.error('stack: KARDATA_MCP_TOKEN not found in staging or prod agents/.env')
    process.exit(1)
  }
  if (!ownerKey) {
    console.error('stack: KARDATA_UI_KEY not found in prod agents/.env (runbook provisioning ritual first)')
    process.exit(1)
  }
  const { Pool } = createRequire(import.meta.url)('pg')
  const pool = new Pool({ connectionString: 'postgresql://kardata:kardata-dev@127.0.0.1:5434/kardata_prod' })
  try {
    for (const keyId of ['prod-worker', 'prod-owner']) {
      const hash = createHash('sha256').update(keyId === 'prod-worker' ? workerKey : ownerKey, 'utf8').digest('hex')
      await pool.query(
        'INSERT INTO api_keys(key_id,key_hash,tenant_id,project_id,roles) VALUES($1,$2,$3,$4,$5) ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash',
        [keyId, hash, 'tenant-prod', null, 'approver'],
      )
      console.log(`stack: prod key '${keyId}' registered (tenant-prod, approver)`)
    }
  } catch (error) {
    console.error(`stack: key provisioning failed (prod db up?): ${String(error?.message ?? error).slice(0, 200)}`)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

async function cmdProdDeploy(args) {
  requireProdDir()
  const level = profileOf(args, 'full')
  const fetch = await run('git', ['fetch', 'origin', 'prod'], { cwd: ROOT })
  if (!fetch.ok) {
    console.error('stack: cannot fetch origin/prod')
    process.exit(1)
  }
  const release = originProdSha()
  if (!release) {
    console.error('stack: origin/prod missing; ship one with: npm run stack:release -- <sha>')
    process.exit(1)
  }
  if (!(await cmdProdBackup())) console.log('stack: WARN continuing without a fresh backup (first deploy?)')
  const prodFetch = await run('git', ['-C', PROD_DIR, 'fetch', 'origin'])
  if (!prodFetch.ok) {
    console.error('stack: cannot fetch inside the prod dir')
    process.exit(1)
  }
  if (args.includes('--rollback')) {
    // Move the release worktree BACKWARD onto the rolled-back release.
    // Refuse on tracked modifications (the worktree stays pristine);
    // ignored files (agents/.env, var/backups) survive the reset.
    const dirty = await run('git', ['-C', PROD_DIR, 'status', '--porcelain', '--untracked-files=no'])
    if (!dirty.ok || dirty.stdout.trim()) {
      console.error('stack: prod dir has tracked modifications; inspect it, never force it')
      process.exit(1)
    }
    const reset = await run('git', ['-C', PROD_DIR, 'reset', '--hard', 'origin/prod'])
    if (!reset.ok) {
      console.error(`stack: prod reset failed${reset.stderr ? `: ${reset.stderr.slice(0, 200)}` : ''}`)
      process.exit(1)
    }
    console.log(`stack: ROLLBACK — prod dir reset to origin/prod ${release.slice(0, 9)}`)
  } else {
    const ff = await run('git', ['-C', PROD_DIR, 'merge', '--ff-only', 'origin/prod'])
    if (!ff.ok) {
      console.error('stack: prod dir is not fast-forwardable to origin/prod; inspect it, never force it')
      process.exit(1)
    }
  }
  const head = prodWorktreeSha()
  if (head !== release) {
    console.error(`stack: prod dir is ${head?.slice(0, 9)} but origin/prod is ${release.slice(0, 9)}; refusing to build a drifted tree`)
    process.exit(1)
  }
  console.log(`stack: deploying prod from origin/prod ${release.slice(0, 9)}`)
  const uiKey = prodEnv(level)['KARDATA_UI_KEY']
  const targets = uiKey ? ['backend', 'worker', 'ui'] : ['backend', 'worker']
  if (!uiKey) console.log('stack: WARN no KARDATA_UI_KEY in prod env; skipping UI (runbook provisioning ritual, then redeploy)')
  const build = await prodCompose(['build', ...targets], level)
  process.stdout.write(build.stdout || build.stderr)
  if (!build.ok) process.exit(1)
  const replicas = RESOURCE_PROFILES[level].workerReplicas
  const services = [...PROD_APP_SERVICES, ...PROD_OBS_SERVICES]
  if (uiKey) services.push('ui')
  // Fresh containers for the rebuilt services: stale env and stale logs
  // (a past [FATAL], an old boot line) must never pass or fail this deploy.
  // db/temporal/obs start but never recreate (volumes hold the data).
  const since = new Date(Date.now() - 5000).toISOString()
  const keep = services.filter((s) => !targets.includes(s))
  const upKeep = await prodCompose(['up', '-d', ...keep], level)
  process.stdout.write(upKeep.stdout || upKeep.stderr)
  if (!upKeep.ok) process.exit(1)
  const up = await prodCompose(['up', '-d', '--scale', `worker=${replicas}`, '--force-recreate', ...targets], level)
  process.stdout.write(up.stdout || up.stderr)
  if (!up.ok) process.exit(1)
  const okBackend = await waitFor('prod backend /healthz', () => urlHealthy(`${PROD_BACKEND_URL}/healthz`))
  const ps = await prodPs()
  const workerNames = ps.filter((s) => s.Service === 'worker' && s.State === 'running').map((s) => s.Name)
  let okWorker = workerNames.length > 0
  for (const name of workerNames) {
    if (!(await waitFor(`prod worker ${name}`, () => containerLogHas(name, 'turn worker polling', since)))) okWorker = false
  }
  let okUi = true
  if (uiKey) okUi = await waitFor('prod ui /healthz', () => urlHealthy(`${PROD_UI_URL}/healthz`))
  if (!okBackend || !okWorker || !okUi) process.exit(1)
  const backend = ps.find((s) => s.Service === 'backend')?.Name ?? 'kardata-prod-backend-1'
  for (const name of [backend, ...workerNames]) {
    if (await containerLogHas(name, '[FATAL]', since)) {
      console.error(`stack: ${name} reports [FATAL]; see: docker logs --since ${since} ${name}`)
      process.exit(1)
    }
  }
  const served = await servedToolCount(PROD_BACKEND_URL, uiKey ?? null)
  const parity = parityVerdict({ served, repo: repoToolCount() })
  console.log(formatVerdict('mcp-parity', parity))
  if (parity.level === 'fail') process.exit(1)
  console.log(`stack: prod deploy green (${release.slice(0, 9)})`)
}

async function cmdProd(args) {
  const [sub, ...rest] = args
  if (sub === 'up') return cmdProdUp(rest)
  if (sub === 'down') return cmdProdDown()
  if (sub === 'status') return cmdProdStatus()
  if (sub === 'deploy') return cmdProdDeploy(rest)
  if (sub === 'provision-keys') return cmdProdProvisionKeys()
  if (sub === 'backup') {
    if (!(await cmdProdBackup())) process.exit(1)
    return
  }
  console.error('usage: npm run stack:prod -- <up|down|status|deploy [--rollback]|provision-keys|backup> [--profile lean|full]')
  process.exit(1)
}

async function cmdRelease(args) {
  const rollback = args.includes('--rollback')
  const shaArg = args.find((a) => !a.startsWith('--'))
  if (!shaArg) {
    console.error('usage: npm run stack:release -- <sha> [--rollback]')
    process.exit(1)
  }
  const rev = await run('git', ['rev-parse', shaArg], { cwd: ROOT })
  const sha = rev.ok ? rev.stdout.trim() : null
  if (!sha) {
    console.error(`stack: unknown revision '${shaArg}'`)
    process.exit(1)
  }
  await run('git', ['fetch', 'origin', 'main', 'prod'], { cwd: ROOT })
  if (!rollback) {
    const onMain = await run('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: ROOT })
    if (!onMain.ok) {
      console.error('stack: release takes main-line SHAs only; merge first, then release')
      process.exit(1)
    }
    const current = originProdSha()
    if (current && current !== sha) {
      const ff = await run('git', ['merge-base', '--is-ancestor', current, sha], { cwd: ROOT })
      if (!ff.ok) {
        console.error(`stack: ${sha.slice(0, 9)} is not ahead of origin/prod ${current.slice(0, 9)}; move prod back with --rollback`)
        process.exit(1)
      }
    }
    const push = await run('git', ['push', 'origin', `${sha}:refs/heads/prod`], { cwd: ROOT })
    process.stdout.write(push.stdout || push.stderr)
    if (!push.ok) process.exit(1)
  } else {
    console.log(`stack: ROLLBACK — moving origin/prod back to ${sha.slice(0, 9)}`)
    const push = await run('git', ['push', '--force-with-lease', 'origin', `${sha}:refs/heads/prod`], { cwd: ROOT })
    process.stdout.write(push.stdout || push.stderr)
    if (!push.ok) process.exit(1)
  }
  console.log(`stack: origin/prod is now ${sha.slice(0, 9)}; run stack:prod deploy to apply it`)
}

async function cmdResources() {
  console.log('resource profiles (compose env + worker --scale):')
  for (const [name, profile] of Object.entries(RESOURCE_PROFILES)) {
    console.log(`  ${name}: replicas=${profile.workerReplicas} pools=${profile.dbPoolServer}/${profile.dbPoolWorker} meta=${profile.metaMaxConcurrent} browser=${profile.browserMax}`)
  }
  console.log('defaults: staging lean, prod full. apply: stack:rebalance <normal|testing>, stack:prod up --profile <lean|full>')
  console.log('note: the Meta vendor account is shared across envs (full+full peaks at 16 vendor calls)')
}

async function stagingUp(level) {
  const profile = profileEnv(level)
  const env = { ...composeEnv(), ...profile }
  const replicas = RESOURCE_PROFILES[level].workerReplicas
  return run('docker', ['compose', '-f', COMPOSE, 'up', '-d', '--scale', `worker=${replicas}`, ...APP_SERVICES, ...OBS_SERVICES], { env })
}

async function cmdRebalance(args) {
  const [mode] = args
  if (mode !== 'normal' && mode !== 'testing') {
    console.error('usage: npm run stack:rebalance -- <normal|testing>')
    process.exit(1)
  }
  let ok = true
  if (mode === 'testing') {
    // Prod to 0 (volumes kept), staging to full.
    const down = await prodCompose(['down']).catch(() => ({ ok: false, stdout: '', stderr: 'prod dir missing?' }))
    if (!down.ok) {
      console.log('stack: WARN prod down failed (already down or dir missing); continuing')
    } else {
      console.log('stack: prod down (volumes kept)')
    }
    const up = await stagingUp('full')
    if (!up.ok) {
      console.log('stack: WARN staging full boot failed (test stack holding ports?); profile recorded, boot skipped')
      ok = false
    } else {
      console.log('stack: staging full (worker x4)')
    }
  } else {
    const up = await stagingUp('lean')
    if (!up.ok) {
      console.log('stack: WARN staging lean boot failed; continuing to prod')
      ok = false
    } else {
      console.log('stack: staging lean (worker x1)')
    }
    requireProdDir()
    await cmdProdUp(['--profile', 'full'])
  }
  if (!ok) process.exit(1)
  console.log(`stack: rebalance ${mode} complete`)
}

const commands = {
  up: ['boot the compose stack with existing images', cmdUp],
  toxi: ['toxiproxy for fault drills: up|down (host network, 127.0.0.1:8474)', cmdToxi],
  clean: ['stop the live stack plus owned stale test servers/workers', cmdClean],
  down: ['stop the stack (volumes kept, never deleted)', cmdDown],
  obs: ['start temporal-ui + telemetry (fails if another stack holds the ports)', cmdObs],
  deploy: ['rebuild backend+worker from HEAD, boot, verify health + MCP parity', cmdDeploy],
  status: ['stack state + image freshness vs HEAD', cmdStatus],
  doctor: ['fail on duplicate fleets / stale images; warn + fixes otherwise', cmdDoctor],
  'worker:host': ['refuse if a host worker polls, else stop compose worker and run the laptop one', cmdWorkerHost],
  'worker:compose': ['refuse if a host worker polls, else start the compose worker', cmdWorkerCompose],
  worker: ['scale the compose worker (default 1): stack.mjs worker --replicas N', cmdWorker],
  prod: ['prod env: up|down|status|deploy|provision-keys|backup [--profile lean|full]', cmdProd],
  release: ['ship a main-line SHA to origin/prod [--rollback to move back]', cmdRelease],
  resources: ['show the lean/full resource profiles', cmdResources],
  rebalance: ['normal (staging lean + prod full) | testing (prod 0 + staging full)', cmdRebalance],
}

const [command, ...commandArgs] = process.argv.slice(2)
if (!command || !(command in commands)) {
  console.log('usage: npm run stack:<command>')
  for (const [name, [help]] of Object.entries(commands)) console.log(`  ${name.padEnd(14)} ${help}`)
  process.exit(command ? 1 : 0)
}
await commands[command][1](commandArgs)
