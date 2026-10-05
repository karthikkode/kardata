// Guard for tests/backend/live/guard.ts: the backend live battery and the
// live browser stack share the kardata-live namespace, so each refuses to
// start while the other is up (sector-backend-v1 handoff bug 13).
// Hermetic: stub probes plus loopback servers only, no DB or Temporal.
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { assertBrowserStackDown, probeHealthz } from './live/guard.js'

describe('live concurrency guard', () => {
  it('refuses the battery while the browser stack is up, naming the fix', async () => {
    await expect(assertBrowserStackDown(async () => true)).rejects.toThrow('live-stack-stop.sh')
  })

  it('lets the battery start when the browser stack is down', async () => {
    await expect(assertBrowserStackDown(async () => false)).resolves.toBeUndefined()
  })

  it('probes a closed port as down', async () => {
    const held = createServer()
    await new Promise<void>((resolve) => held.listen(0, '127.0.0.1', resolve))
    const port = (held.address() as { port: number }).port
    await new Promise<void>((resolve) => held.close(() => resolve()))
    await expect(probeHealthz(port)).resolves.toBe(false)
  })

  it('probes a live healthz as up', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    try {
      await expect(probeHealthz(port)).resolves.toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
