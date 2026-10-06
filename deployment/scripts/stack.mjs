#!/usr/bin/env node
// One-command local platform: `npm run stack:<up|down|deploy|status|doctor|worker:host|worker:compose>`.
// Compose-first: the compose stack owns the runtime; the host worker path
// exists for laptop dev and can never run alongside the compose worker.
// Verdict logic lives in stack-lib.mjs (pure, unit-tested); this file only
// gathers facts (docker, git, curl) and acts on them.
import { execFile, execFileSync, spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readlinkSync } from 'node:fs'
import { countRepoTools, fleetVerdict, formatVerdict, freshnessVerdict, ownedTestProcs, parityVerdict, parseEnvFile } from './stack-lib.mjs'

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

async function backendHealthy() {
  try {
    const response = await fetch(`${BACKEND_URL}/healthz`, { signal: AbortSignal.timeout(5000) })
    const body = await response.json()
    return response.ok && body?.ok === true
  } catch { return false }
}

async function containerLogHas(container, needle) {
  const out = await run('docker', ['logs', '--tail', '200', container])
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

async function servedToolCount() {
  const apiKey = readKey(join(ROOT, 'frontend', '.env'), 'VITE_STAGING_KEY')
  if (!apiKey) return null
  try {
    const response = await fetch(`${BACKEND_URL}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(15000),
    })
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
  ]
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
    const created = await run('docker', ['run', '-d', '--name', 'kardata-toxiproxy', '--network', 'host', 'shopify/toxiproxy:latest'])
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
}

const [command, ...commandArgs] = process.argv.slice(2)
if (!command || !(command in commands)) {
  console.log('usage: npm run stack:<command>')
  for (const [name, [help]] of Object.entries(commands)) console.log(`  ${name.padEnd(14)} ${help}`)
  process.exit(command ? 1 : 0)
}
await commands[command][1](commandArgs)
