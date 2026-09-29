// Bounded browser slot pool: 0..16 concurrent browser sessions, lazy.
// RAM discipline: nothing is pre-allocated; a Chromium context is created
// on acquire and closed on release or idle-reap, so an idle pool holds
// zero browser memory and takes host RAM only under load.
// Progress rule: saturation rejects new acquires with `overload`; active
// sessions are never evicted, so one agent's request never drops another
// agent's page. Cursors and caches live outside slots (see cache.ts and
// facade.ts): a released slot never takes a pagination cursor with it.
import { RetrievalError } from '../retrieval/web.js'

/** Absolute ceiling: owner-approved max is 16 browsers. */
export const BROWSER_POOL_ABSOLUTE_MAX = 16
/** Starting default; raise via KARDATA_BROWSER_MAX up to the ceiling. */
export const BROWSER_POOL_DEFAULT_MAX = 8
/** Waiting acquires past this reject immediately: backpressure, not OOM. */
const MAX_QUEUED = 64
/** Active + queued slots per caller: one sweep cannot hog the pool. */
const CALLER_SLOT_CAP = 4
/** Acquire waits this long for a slot before rejecting with overload. */
export const BROWSER_SLOT_TIMEOUT_MS = 30_000

export interface BrowserSlot {
  release(): void
}

interface Waiter {
  host: string
  caller: string
  resolve: (slot: BrowserSlot) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let overrideMax: number | undefined
let active = 0
const hostLocks = new Set<string>()
const callerCounts = new Map<string, number>()
const queue: Waiter[] = []

/** Effective max: test override, else KARDATA_BROWSER_MAX clamped 1..16. */
export function browserPoolMax(): number {
  if (overrideMax !== undefined) return overrideMax
  const raw = process.env['KARDATA_BROWSER_MAX']?.trim()
  if (!raw) return BROWSER_POOL_DEFAULT_MAX
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed)) return BROWSER_POOL_DEFAULT_MAX
  return Math.min(Math.max(parsed, 1), BROWSER_POOL_ABSOLUTE_MAX)
}

export function setBrowserPoolMaxForTests(max: number): void {
  overrideMax = Math.min(Math.max(Math.floor(max), 1), BROWSER_POOL_ABSOLUTE_MAX)
}

function releaseSlot(host: string, caller: string): void {
  active = Math.max(0, active - 1)
  // Per-host serialization guarantees at most one active holder per host,
  // so deleting on release cannot unlock another session's host.
  if (host) hostLocks.delete(host)
  const count = callerCounts.get(caller) ?? 1
  if (count <= 1) callerCounts.delete(caller)
  else callerCounts.set(caller, count - 1)
  drain()
}

function makeSlot(host: string, caller: string): BrowserSlot {
  let released = false
  return {
    release() {
      if (released) return
      released = true
      releaseSlot(host, caller)
    },
  }
}

function drain(): void {
  while (queue.length > 0) {
    if (active >= browserPoolMax()) return
    const idx = queue.findIndex((waiter) => !waiter.host || !hostLocks.has(waiter.host))
    if (idx === -1) return
    const [waiter] = queue.splice(idx, 1) as [Waiter]
    clearTimeout(waiter.timer)
    // The waiter already counts against its caller cap from enqueue time;
    // granting converts queued to active with no count change.
    active += 1
    if (waiter.host) hostLocks.add(waiter.host)
    waiter.resolve(makeSlot(waiter.host, waiter.caller))
  }
}

/** Acquire one browser slot. Waits FIFO until timeoutMs, then overload. */
export function acquireBrowserSlot(input: { host?: string; caller?: string; timeoutMs?: number }): Promise<BrowserSlot> {
  const host = (input.host ?? '').trim().toLowerCase()
  const caller = (input.caller ?? '').trim() || 'anon'
  const timeoutMs = input.timeoutMs ?? BROWSER_SLOT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RetrievalError('validation_failed', 'timeoutMs must be >= 0')
  }
  const held = callerCounts.get(caller) ?? 0
  if (held >= CALLER_SLOT_CAP) {
    throw new RetrievalError('overload', `caller ${caller} holds ${held} browser slots (cap ${CALLER_SLOT_CAP})`)
  }
  if (active < browserPoolMax() && (!host || !hostLocks.has(host))) {
    active += 1
    callerCounts.set(caller, held + 1)
    if (host) hostLocks.add(host)
    return Promise.resolve(makeSlot(host, caller))
  }
  if (timeoutMs === 0) {
    throw new RetrievalError('overload', `browser pool saturated (${active}/${browserPoolMax()})`)
  }
  if (queue.length >= MAX_QUEUED) {
    throw new RetrievalError('overload', `browser pool queue full (${MAX_QUEUED})`)
  }
  callerCounts.set(caller, held + 1)
  return new Promise<BrowserSlot>((resolve, reject) => {
    const waiter: Waiter = {
      host,
      caller,
      resolve,
      reject,
      timer: setTimeout(() => {
        const idx = queue.indexOf(waiter)
        if (idx !== -1) queue.splice(idx, 1)
        const count = callerCounts.get(caller) ?? 1
        if (count <= 1) callerCounts.delete(caller)
        else callerCounts.set(caller, count - 1)
        reject(new RetrievalError('overload', `browser pool saturated (${active}/${browserPoolMax()})`))
      }, timeoutMs),
    }
    queue.push(waiter)
    drain()
  })
}

export function browserPoolStats(): { active: number; queued: number; max: number; hosts: number } {
  return { active, queued: queue.length, max: browserPoolMax(), hosts: hostLocks.size }
}

/** Hermetic reset: pending waiters reject, counters zero, max override off. */
export function resetBrowserPoolForTests(): void {
  for (const waiter of queue.splice(0)) {
    clearTimeout(waiter.timer)
    waiter.reject(new RetrievalError('overload', 'browser pool reset'))
  }
  active = 0
  hostLocks.clear()
  callerCounts.clear()
  overrideMax = undefined
}
