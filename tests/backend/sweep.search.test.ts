// Sweep search fallback (keyed -> keyless -> browser). No open-internet
// calls: engines answer from fixture doubles, the chain runs on stub
// legs, and the real browser leg stays behind KARDATA_BROWSER_TEST.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearBrowserCacheForTests } from '../../backend/src/browserPool/cache.js'
import { resetBrowserPoolForTests } from '../../backend/src/browserPool/pool.js'
import { RetrievalError } from '../../backend/src/retrieval/web.js'
import { keylessSearch, type KeylessHit } from '../../backend/src/retrieval/keyless.js'
import {
  linksFromSnapshot,
  searchWebPageActivity,
  type SweepSearchHit,
} from '../../backend/src/temporal/activities/sweep.js'

const DDG_HTML = `<html><body>
<div class="result results_links_deep highlight_d">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?kh=-1&amp;uddg=https%3A%2F%2Facme.example%2Fshop">Acme Foods</a>
<a class="result__snippet" href="https://acme.example/shop">artisanal pantry goods</a>
</div>
<div class="result">
<a rel="nofollow" class="result__a" href="https://duckduckgo.com/settings">Settings</a>
</div>
<div class="result">
<a rel="nofollow" class="result__a" href="https://betapantry.example">Beta Pantry</a>
</div>
</body></html>`

const LITE_HTML = `<html><body><table>
<tr><td><a rel="nofollow" href="https://lite.example">Lite Co</a></td></tr>
</table></body></html>`

function routeDouble(routes: Array<{ match: string; status: number; body: string }>): typeof fetch {
  return (async (url: string) => {
    const route = routes.find((entry) => String(url).includes(entry.match))
    if (!route) return new Response('missing', { status: 500 })
    return new Response(route.body, { status: route.status, headers: { 'content-type': 'text/html' } })
  }) as typeof fetch
}

describe('keylessSearch', () => {
  it('parses DDG anchors, decodes wrapped URLs, drops internal links', async () => {
    const hits = await keylessSearch('acme foods', {
      fetchImpl: routeDouble([{ match: 'duckduckgo', status: 200, body: DDG_HTML }]),
    })
    expect(hits).toEqual([
      { title: 'Acme Foods', url: 'https://acme.example/shop', snippet: 'artisanal pantry goods', engine: 'duckduckgo' },
      { title: 'Beta Pantry', url: 'https://betapantry.example', snippet: '', engine: 'duckduckgo' },
    ])
  })

  it('skips failed and challenged engines for the next one', async () => {
    const hits = await keylessSearch('acme foods', {
      fetchImpl: routeDouble([
        { match: 'html.duckduckgo.com', status: 500, body: 'down' },
        { match: 'lite.duckduckgo.com', status: 200, body: LITE_HTML },
      ]),
    })
    expect(hits).toEqual([{ title: 'Lite Co', url: 'https://lite.example', snippet: '', engine: 'duckduckgo-lite' }])

    const challenged = await keylessSearch('acme foods', {
      fetchImpl: routeDouble([
        { match: 'html.duckduckgo.com', status: 200, body: '<div class="anomaly-modal">challenge</div>' },
        { match: 'lite.duckduckgo.com', status: 200, body: LITE_HTML },
      ]),
    })
    expect(challenged[0]?.engine).toBe('duckduckgo-lite')
  })

  it('fails loudly when the whole pool yields nothing, validates first', async () => {
    const dead = routeDouble([])
    await expect(keylessSearch('acme foods', { fetchImpl: dead })).rejects.toMatchObject({ code: 'fetch_failed' })
    let called = 0
    const spy = (async () => {
      called += 1
      return new Response('{}')
    }) as typeof fetch
    await expect(keylessSearch('x', { fetchImpl: spy })).rejects.toMatchObject({ code: 'validation_failed' })
    expect(called).toBe(0)
  })
})

describe('linksFromSnapshot', () => {
  it('extracts bare URLs, drops engine hosts and dupes, caps the list', () => {
    const snapshot = `- link "Acme" [ref=e1]: https://acme.example/shop
- link "DDG" [ref=e2]: https://duckduckgo.com/settings
- text "see https://acme.example/shop and https://betapantry.example."`
    expect(linksFromSnapshot(snapshot)).toEqual([
      { title: 'acme.example', url: 'https://acme.example/shop', snippet: '', via: 'browser' },
      { title: 'betapantry.example', url: 'https://betapantry.example', snippet: '', via: 'browser' },
    ])
    expect(linksFromSnapshot(snapshot, 1)).toHaveLength(1)
  })
})

describe('searchWebPageActivity fallback chain', () => {
  const savedKey = process.env['KARDATA_WEB_SEARCH_KEY']
  beforeEach(() => {
    // The facade caches query pages across calls: stub-leg routing tests
    // need a cold cache, or one test's legs answer another's query.
    clearBrowserCacheForTests()
    resetBrowserPoolForTests()
  })
  afterEach(() => {
    if (savedKey === undefined) delete process.env['KARDATA_WEB_SEARCH_KEY']
    else process.env['KARDATA_WEB_SEARCH_KEY'] = savedKey
  })

  const keyedHits = [{ title: 'Keyed', url: 'https://keyed.example', snippet: '' }]
  const keylessHits: KeylessHit[] = [
    { title: 'Free', url: 'https://free.example', snippet: '', engine: 'duckduckgo' },
  ]
  const browserHits: SweepSearchHit[] = [
    { title: 'host.example', url: 'https://host.example', snippet: '', via: 'browser' },
  ]
  const boom = (code: 'fetch_failed' | 'blocked' = 'fetch_failed') => async (): Promise<never> => {
    throw new RetrievalError(code, 'leg down')
  }

  it('prefers keyed when the key is set and never calls the other legs', async () => {
    process.env['KARDATA_WEB_SEARCH_KEY'] = 'k'
    let keylessCalled = 0
    let browserCalled = 0
    const hits = await searchWebPageActivity(
      { query: 'acme foods', page: 0 },
      {
        keyed: async () => keyedHits,
        keyless: async () => {
          keylessCalled += 1
          return keylessHits
        },
        browser: async () => {
          browserCalled += 1
          return browserHits
        },
      },
    )
    expect(hits).toEqual([{ ...keyedHits[0], via: 'keyed' }])
    expect(keylessCalled).toBe(0)
    expect(browserCalled).toBe(0)
  })

  it('falls keyed -> keyless on keyed failure, skipping keyed without a key', async () => {
    delete process.env['KARDATA_WEB_SEARCH_KEY']
    let keyedCalled = 0
    const hits = await searchWebPageActivity(
      { query: 'acme foods', page: 0 },
      {
        keyed: async () => {
          keyedCalled += 1
          return keyedHits
        },
        keyless: async () => keylessHits,
        browser: async () => browserHits,
      },
    )
    expect(keyedCalled).toBe(0)
    expect(hits).toEqual([{ ...keylessHits[0], via: 'keyless' }])

    process.env['KARDATA_WEB_SEARCH_KEY'] = 'k'
    const afterKeyedFailure = await searchWebPageActivity(
      { query: 'acme foods', page: 0 },
      { keyed: boom(), keyless: async () => keylessHits, browser: async () => browserHits },
    )
    expect(afterKeyedFailure).toEqual([{ ...keylessHits[0], via: 'keyless' }])
  })

  it('uses the browser leg on page 0 when automated search is blocked, empty after', async () => {
    delete process.env['KARDATA_WEB_SEARCH_KEY']
    let browserCalled = 0
    const page0 = await searchWebPageActivity(
      { query: 'acme foods', page: 0 },
      {
        keyless: boom('blocked'),
        browser: async () => {
          browserCalled += 1
          return browserHits
        },
      },
    )
    expect(page0).toEqual(browserHits)
    const page1 = await searchWebPageActivity(
      { query: 'acme foods', page: 1 },
      { keyless: boom('blocked'), browser: async () => browserHits },
    )
    expect(page1).toEqual([])
    expect(browserCalled).toBe(1)
  })

  it('fails loudly when every leg is down, validates before any leg', async () => {
    delete process.env['KARDATA_WEB_SEARCH_KEY']
    await expect(
      searchWebPageActivity({ query: 'acme foods', page: 0 }, { keyless: boom(), browser: boom() }),
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    let called = 0
    const counting = async (): Promise<KeylessHit[]> => {
      called += 1
      return keylessHits
    }
    await expect(searchWebPageActivity({ query: 'x', page: 0 }, { keyless: counting })).rejects.toMatchObject({
      code: 'validation_failed',
    })
    await expect(searchWebPageActivity({ query: 'acme foods', page: -1 }, { keyless: counting })).rejects.toMatchObject(
      { code: 'validation_failed' },
    )
    expect(called).toBe(0)
  })
})
