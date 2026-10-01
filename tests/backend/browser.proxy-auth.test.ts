import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { configureBrowserProxyContext } from '../../backend/src/retrieval/proxy.js'
interface Challenge { requestId: string; authChallenge: { source: string; origin: string } }
describe('browser proxy challenge authority', () => {
  it('supplies a capability only to our proxy, never site challenges or other proxy origins', async () => {
    const handlers = new Map<string, (event: Challenge) => void>()
    const session = { on: vi.fn((name: string, callback: (event: Challenge) => void) => handlers.set(name, callback)), send: vi.fn().mockResolvedValue({}) }
    const context = { on: vi.fn(), newCDPSession: vi.fn().mockResolvedValue(session) } as unknown as BrowserContext
    const page = { close: vi.fn().mockResolvedValue(undefined) } as unknown as Page
    const proxy = { server: 'http://proxy-control.test:3001', username: 'TEST_CAPABILITY', password: 'TEST_SIGNATURE', bypass: '<-loopback>' }
    await configureBrowserProxyContext(context, proxy)(page)
    const auth = handlers.get('Fetch.authRequired')!
    for (const [id, source, origin] of [
      ['site', 'Server', proxy.server], ['public', 'Server', 'https://site.test'],
      ['other', 'Proxy', 'http://other-proxy.test:3001'], ['malformed', 'Proxy', 'invalid'],
      ['userinfo', 'Proxy', 'http://fake@proxy-control.test:3001'],
    ]) {
      auth({ requestId: id!, authChallenge: { source: source!, origin: origin! } })
      expect(session.send).toHaveBeenLastCalledWith('Fetch.continueWithAuth', { requestId: id, authChallengeResponse: { response: 'CancelAuth' } })
    }
    auth({ requestId: 'our-proxy', authChallenge: { source: 'Proxy', origin: proxy.server } })
    expect(session.send).toHaveBeenLastCalledWith('Fetch.continueWithAuth', { requestId: 'our-proxy', authChallengeResponse: { response: 'ProvideCredentials', username: proxy.username, password: proxy.password } })
    auth({ requestId: 'our-proxy', authChallenge: { source: 'Proxy', origin: proxy.server } })
    expect(session.send).toHaveBeenLastCalledWith('Fetch.continueWithAuth', { requestId: 'our-proxy', authChallengeResponse: { response: 'CancelAuth' } })
  })
})
