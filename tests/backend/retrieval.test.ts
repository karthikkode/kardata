// Web retrieval proofs (Phase 6). No open-internet calls: fetch is
// injected with server-shaped doubles, search answers from an injected
// endpoint double, and browser launch tests gate on KARDATA_BROWSER_TEST
// (needs a local Chromium) exactly like the Temporal suites.
import { describe, expect, it } from 'vitest'
import { RetrievalError, webFetch, webSearch } from '../../backend/src/retrieval/web.js'
import { browserAct, browserClose, browserNavigate, browserScreenshot, browserSnapshot } from '../../backend/src/retrieval/browser.js'

function htmlDouble(body: string, contentType = 'text/html'): typeof fetch {
  return (async () => new Response(body, { status: 200, headers: { 'content-type': contentType } })) as typeof fetch
}

describe('webFetch', () => {
  it('strips pages to readable text', async () => {
    const result = await webFetch(
      'https://example.com/page',
      htmlDouble('<html><head><style>.x{}</style></head><body><h1>Acme</h1><script>evil()</script><p>Makes widgets.</p></body></html>'),
    )
    expect(result.status).toBe(200)
    expect(result.text).toContain('Acme')
    expect(result.text).toContain('Makes widgets.')
    expect(result.text).not.toContain('evil()')
  })

  it('passes plain text through and refuses binaries, hosts, and schemes', async () => {
    const text = await webFetch('https://example.com/robots.txt', htmlDouble('User-agent: *', 'text/plain'))
    expect(text.text).toBe('User-agent: *')
    await expect(
      webFetch('https://example.com/app.zip', htmlDouble('bytes', 'application/zip')),
    ).rejects.toMatchObject({ code: 'blocked' })
    await expect(webFetch('http://localhost:3000/x', htmlDouble('x'))).rejects.toMatchObject({ code: 'blocked' })
    await expect(webFetch('http://169.254.169.254/', htmlDouble('x'))).rejects.toMatchObject({ code: 'blocked' })
    await expect(webFetch('ftp://example.com/x', htmlDouble('x'))).rejects.toMatchObject({ code: 'blocked' })
    await expect(webFetch('not a url', htmlDouble('x'))).rejects.toBeInstanceOf(RetrievalError)
  })

  it('fails HTTP errors and oversize bodies', async () => {
    const missing = (async () => new Response('nope', { status: 404 })) as typeof fetch
    await expect(webFetch('https://example.com/missing', missing)).rejects.toMatchObject({ code: 'fetch_failed' })
    const huge = (async () => new Response('x'.repeat(3 * 1024 * 1024), { status: 200 })) as typeof fetch
    await expect(webFetch('https://example.com/huge', huge)).rejects.toMatchObject({ code: 'fetch_failed' })
  })
})

describe('webSearch', () => {
  it('fails closed without a key, never an empty list', async () => {
    await expect(webSearch({}, 'acme widgets')).rejects.toMatchObject({ code: 'unconfigured' })
    await expect(webSearch({ KARDATA_WEB_SEARCH_KEY: '  ' }, 'acme widgets')).rejects.toMatchObject({
      code: 'unconfigured',
    })
  })

  it('validates queries before any network', async () => {
    let called = 0
    const spy = (async () => {
      called += 1
      return new Response('{}')
    }) as typeof fetch
    await expect(
      webSearch({ KARDATA_WEB_SEARCH_KEY: 'k' }, 'x', { fetchImpl: spy }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(called).toBe(0)
  })

  it('parses Brave-compatible results with pagination', async () => {
    const seen: string[] = []
    const endpoint = (async (url: string) => {
      seen.push(url)
      return new Response(
        JSON.stringify({
          web: { results: [{ title: 'Acme', url: 'https://acme.example', description: 'widgets' }] },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const hits = await webSearch({ KARDATA_WEB_SEARCH_KEY: 'k' }, 'acme', { count: 5, page: 2, fetchImpl: endpoint })
    expect(hits).toEqual([{ title: 'Acme', url: 'https://acme.example', snippet: 'widgets' }])
    expect(seen[0]).toContain('count=5')
    expect(seen[0]).toContain('offset=10')
  })
})

const BROWSER_ENABLED = (process.env['KARDATA_BROWSER_TEST'] ?? '') !== ''

describe('browser sessions', () => {
  it('rejects unknown sessions and bad args without launching', async () => {
    await expect(browserNavigate('')).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(browserSnapshot('browser-nope')).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(browserClose('browser-nope')).resolves.toMatchObject({ ok: true })
    await expect(
      browserAct('browser-nope', { kind: 'click', selector: 'a' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(browserScreenshot('browser-nope')).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('routes Chromium through the CDP sidecar when configured', async () => {
    const saved = process.env['KARDATA_CHROME_CDP_URL']
    try {
      process.env['KARDATA_CHROME_CDP_URL'] = 'not-a-url'
      await expect(browserNavigate('https://example.com')).rejects.toMatchObject({ code: 'validation_failed' })
      process.env['KARDATA_CHROME_CDP_URL'] = 'http://127.0.0.1:9'
      await expect(browserNavigate('https://example.com')).rejects.toMatchObject({ code: 'unconfigured' })
    } finally {
      if (saved === undefined) delete process.env['KARDATA_CHROME_CDP_URL']
      else process.env['KARDATA_CHROME_CDP_URL'] = saved
    }
  })

  it.skipIf(!BROWSER_ENABLED)('navigates, snapshots, acts, and closes a real page', async () => {
    const opened = await browserNavigate('https://example.com')
    expect(opened.url).toContain('example.com')
    // Structural assertions only: example.com removed its "Example Domain"
    // heading 2026-09 (observed live drift), so the test pins the stable
    // link target plus a non-empty snapshot instead of third-party copy.
    expect(opened.snapshot.length).toBeGreaterThan(0)
    expect(opened.snapshot).toContain('iana.org')
    const after = await browserAct(opened.sessionId, { kind: 'press', key: 'End' })
    expect(after.url).toContain('example.com')
    const shot = await browserScreenshot(opened.sessionId)
    expect(shot.mimeType).toBe('image/jpeg')
    expect(shot.bytes).toBeGreaterThan(0)
    expect(shot.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(shot.dataBase64.length).toBeGreaterThan(0)
    await expect(browserClose(opened.sessionId)).resolves.toMatchObject({ ok: true })
  })
})
