// Browser pool: bounded 0-16 slots, TTL caches, single facade.
// Failing-first: imports below do not exist yet; green means routing,
// bounds, caching, and progress preservation hold hermetically (no
// Chromium, no network: stub legs only).
import { beforeEach, describe, expect, it } from 'vitest'
import { browserNavigate, browserClose, browserSnapshot } from '../../backend/src/retrieval/browser.js'
import { RetrievalError } from '../../backend/src/retrieval/web.js'
import {
  BROWSER_POOL_ABSOLUTE_MAX,
  acquireBrowserSlot,
  browserPoolStats,
  resetBrowserPoolForTests,
  setBrowserPoolMaxForTests,
} from '../../backend/src/browserPool/pool.js'
import {
  clearBrowserCacheForTests,
  normalizeBrowserUrl,
  queryCacheKey,
} from '../../backend/src/browserPool/cache.js'
import { pooledSearchWebPage } from '../../backend/src/browserPool/facade.js'
import type { KeylessHit } from '../../backend/src/retrieval/keyless.js'
import type { SearchHit } from '../../backend/src/retrieval/web.js'

const keyedHits: SearchHit[] = [{ title: 'Keyed', url: 'https://keyed.example', snippet: '' }]
const keylessHits: KeylessHit[] = [{ title: 'Free', url: 'https://free.example', snippet: '', engine: 'duckduckgo' }]
const browserHits = [{ title: 'host.example', url: 'https://host.example', snippet: '', via: 'browser' as const }]

beforeEach(() => {
  resetBrowserPoolForTests()
  clearBrowserCacheForTests()
  delete process.env['KARDATA_WEB_SEARCH_KEY']
})

describe('pool bounds (0-16, never evict active)', () => {
  it('caps at the absolute max and scales from zero', () => {
    expect(BROWSER_POOL_ABSOLUTE_MAX).toBe(16)
    expect(browserPoolStats().active).toBe(0)
    expect(browserPoolStats().max).toBeGreaterThanOrEqual(1)
    expect(browserPoolStats().max).toBeLessThanOrEqual(16)
  })

  it('rejects new acquires at saturation with overload, never evicting holders', async () => {
    setBrowserPoolMaxForTests(1)
    const holder = await acquireBrowserSlot({ host: 'a.example', caller: 'agent-a', timeoutMs: 50 })
    expect(browserPoolStats().active).toBe(1)
    await expect(acquireBrowserSlot({ host: 'b.example', caller: 'agent-b', timeoutMs: 50 })).rejects.toMatchObject({
      code: 'overload',
    })
    // Holder still holds: saturation never evicts progress.
    expect(browserPoolStats().active).toBe(1)
    holder.release()
    expect(browserPoolStats().active).toBe(0)
    const next = await acquireBrowserSlot({ host: 'b.example', caller: 'agent-b', timeoutMs: 50 })
    next.release()
  })

  it('serializes one host at a time while other hosts proceed', async () => {
    setBrowserPoolMaxForTests(16)
    const first = await acquireBrowserSlot({ host: 'same.example', caller: 'a', timeoutMs: 50 })
    await expect(acquireBrowserSlot({ host: 'same.example', caller: 'b', timeoutMs: 30 })).rejects.toMatchObject({
      code: 'overload',
    })
    const other = await acquireBrowserSlot({ host: 'other.example', caller: 'b', timeoutMs: 50 })
    first.release()
    other.release()
    const retry = await acquireBrowserSlot({ host: 'same.example', caller: 'b', timeoutMs: 50 })
    retry.release()
  })

  it('caps slots per caller so one agent cannot hog the pool', async () => {
    setBrowserPoolMaxForTests(16)
    const held = []
    for (let i = 0; i < 4; i += 1) {
      held.push(await acquireBrowserSlot({ host: `hog-${i}.example`, caller: 'hog', timeoutMs: 50 }))
    }
    await expect(acquireBrowserSlot({ host: 'hog-4.example', caller: 'hog', timeoutMs: 20 })).rejects.toMatchObject({
      code: 'overload',
    })
    // Other callers are unaffected by the hog.
    const other = await acquireBrowserSlot({ host: 'free.example', caller: 'free', timeoutMs: 50 })
    for (const slot of held) slot.release()
    other.release()
    const retry = await acquireBrowserSlot({ host: 'hog-4.example', caller: 'hog', timeoutMs: 50 })
    retry.release()
  })
})

describe('cache (cursors outside slots)', () => {
  it('normalizes URLs and query keys so repeats hit', () => {
    expect(normalizeBrowserUrl('https://Example.COM:443/shop/?utm_source=x&b=2&b=1#frag')).toBe(
      'https://example.com/shop?b=1&b=2',
    )
    expect(queryCacheKey('  Acme   Foods ', 10, 0)).toBe(queryCacheKey('acme foods', 10, 0))
  })
})

describe('facade routing (single entry, cached pages)', () => {
  it('prefers keyed, caches the page, and never calls other legs twice', async () => {
    process.env['KARDATA_WEB_SEARCH_KEY'] = 'k'
    let keylessCalled = 0
    let browserCalled = 0
    const deps = {
      keyed: async () => keyedHits,
      keyless: async () => {
        keylessCalled += 1
        return keylessHits
      },
      browser: async () => {
        browserCalled += 1
        return browserHits
      },
    }
    const first = await pooledSearchWebPage({ query: 'acme foods', page: 0 }, deps)
    expect(first).toEqual([{ ...keyedHits[0], via: 'keyed' }])
    const second = await pooledSearchWebPage({ query: 'acme foods', page: 0 }, deps)
    expect(second).toEqual(first)
    expect(keylessCalled).toBe(0)
    expect(browserCalled).toBe(0)
  })

  it('preserves page-0 progress in cache when the browser pool saturates', async () => {
    setBrowserPoolMaxForTests(1)
    const holder = await acquireBrowserSlot({ host: 'held.example', caller: 'agent-hold', timeoutMs: 50 })
    // Page 0 served from the keyless leg and cached: no slot needed.
    const page0 = await pooledSearchWebPage(
      { query: 'acme foods', page: 0 },
      { keyless: async () => keylessHits, browser: async () => browserHits },
    )
    expect(page0[0]).toMatchObject({ via: 'keyless' })
    // Pool still held by the first agent: saturation rejects, holder keeps progress.
    await expect(acquireBrowserSlot({ host: 'new.example', caller: 'agent-new', timeoutMs: 20 })).rejects.toMatchObject({
      code: 'overload',
    })
    expect(browserPoolStats().active).toBe(1)
    // Cached page 0 still serves with zero legs hit.
    const boom = async (): Promise<never> => {
      throw new RetrievalError('fetch_failed', 'must not be called: cache holds page 0')
    }
    const cached = await pooledSearchWebPage({ query: 'acme foods', page: 0 }, { keyless: boom, browser: boom })
    expect(cached).toEqual(page0)
    holder.release()
  })

  it('propagates pool overload from the browser leg instead of a false exhaustive miss', async () => {
    const overloaded = async (): Promise<never> => {
      throw new RetrievalError('overload', 'browser pool saturated (16/16)')
    }
    await expect(
      pooledSearchWebPage({ query: 'overload probe', page: 0 }, { keyless: async () => [], browser: overloaded }),
    ).rejects.toMatchObject({ code: 'overload' })
  })

  it('fails loudly when every leg is down, validates before any leg', async () => {
    const boom = async (): Promise<never> => {
      throw new RetrievalError('fetch_failed', 'leg down')
    }
    await expect(pooledSearchWebPage({ query: 'acme foods', page: 0 }, { keyless: boom, browser: boom })).rejects.toMatchObject({
      code: 'fetch_failed',
    })
    let called = 0
    const counting = async (): Promise<KeylessHit[]> => {
      called += 1
      return keylessHits
    }
    await expect(pooledSearchWebPage({ query: 'x', page: 0 }, { keyless: counting })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(called).toBe(0)
  })
})

const LIVE_BROWSER = (process.env['KARDATA_BROWSER_TEST'] ?? '') !== ''

describe.skipIf(!LIVE_BROWSER)('browser pool under real Chromium', () => {
  it('holds max real sessions and rejects the next with overload, holders keep working', async () => {
    setBrowserPoolMaxForTests(2)
    // Distinct hosts: per-host politeness must not serialize these; only
    // the slot ceiling binds.
    const a = await browserNavigate('https://example.com', { caller: 'live-a', timeoutMs: 60_000 })
    const b = await browserNavigate('https://iana.org', { caller: 'live-b', timeoutMs: 60_000 })
    expect(browserPoolStats().active).toBe(2)
    await expect(
      browserNavigate('https://www.iana.org', { caller: 'live-c', timeoutMs: 2_000 }),
    ).rejects.toMatchObject({ code: 'overload' })
    // Holders are unaffected by saturation: snapshots still serve.
    const snap = await browserSnapshot(a.sessionId, 'live-a')
    expect(snap.url).toContain('example.com')
    await browserClose(a.sessionId, 'live-a')
    // Closing one CDP client must leave the other isolated client alive.
    expect((await browserSnapshot(b.sessionId, 'live-b')).snapshot.length).toBeGreaterThan(0)
    await browserClose(b.sessionId, 'live-b')
    expect(browserPoolStats().active).toBe(0)
  })
})
