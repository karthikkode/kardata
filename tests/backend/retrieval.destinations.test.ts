import { describe, expect, it, vi } from 'vitest'
vi.mock('playwright-core', () => ({ chromium: { launch: vi.fn().mockRejectedValue(new Error('No browser transport permitted in this test')) } }))
import { webFetch } from '../../backend/src/retrieval/web.js'
import { browserNavigate } from '../../backend/src/retrieval/browser.js'
const unsafe = [
  'http://10.0.0.1/', 'http://172.16.1.1/', 'http://192.168.1.1/',
  'http://127.2.3.4/', 'http://2130706433/', 'http://0x7f000001/',
  'http://100.64.0.1/', 'http://169.254.1.1/', 'http://224.0.0.1/',
  'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fc00::1]/',
  'http://[fe80::1]/', 'http://[2001:db8::1]/', 'http://localhost./',
  'http://user:password@example.com/', 'file:///etc/passwd', 'data:text/plain,private',
]
describe('literal public-source destination admission', () => {
  it.each(unsafe)('rejects fetch destination %s before transport', async (url) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('private content'))
    await expect(webFetch(url, transport)).rejects.toMatchObject({ code: 'blocked' })
    expect(transport).not.toHaveBeenCalled()
  })
  it.each(unsafe)('rejects browser destination %s before browser allocation', async (url) => {
    await expect(browserNavigate(url)).rejects.toMatchObject({ code: 'blocked' })
  })
  it('checks literal redirect destinations before following them', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://192.168.1.10/' } }))
    await expect(webFetch('https://example.com/', transport)).rejects.toMatchObject({ code: 'blocked' })
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
