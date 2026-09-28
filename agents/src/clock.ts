// Deterministic time and randomness for the harness. Production code takes a
// Clock; tests inject a frozen or stepped fake. Never call Date.now(),
// Math.random(), or setTimeout directly in harness logic.

// Minimal interface to keep fakes trivial. Extend only with plan approval.
export interface Clock {
  now(): number
}

export function systemClock(): Clock {
  return { now: () => Date.now() }
}

export function frozenClock(fixed: number): Clock & { advance(ms: number): void } {
  let current = fixed
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

// Mulberry32: small, fast, seedable. Good enough for jitter and sampling.
export function seededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}
