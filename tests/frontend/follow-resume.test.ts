// SSE resume proofs: followThread survives socket death, idle silence,
// and malformed frames without losing or duplicating messages, resuming
// from the last good token. fetch is stubbed per connection attempt.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followThread } from '@/data/api/live'
import { type StagingConfig } from '@/data/api/client'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'k' }

afterEach(() => {
  vi.unstubAllGlobals()
})

function frame(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

function streamOf(chunks: Array<Uint8Array | 'die'>): Response {
  // Pull-based: each read delivers one chunk, so frames arrive before a
  // later death (a synchronous error in start() would discard the queue —
  // real sockets deliver first, then die).
  let at = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[at]
      at += 1
      if (chunk === undefined) {
        controller.close()
      } else if (chunk === 'die') {
        controller.error(new Error('socket died'))
      } else {
        controller.enqueue(chunk)
      }
    },
  })
  return { ok: true, status: 200, body: stream } as Response
}

function hangingStream(): Response {
  return { ok: true, status: 200, body: new ReadableStream<Uint8Array>({ start() {} }) } as Response
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const snapshot of gen) out.push(snapshot)
  return out
}

describe('followThread resume', () => {
  it('reconnects a cleanly closed persistent tail without losing the last token', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return streamOf([frame({ seq: urls.length, type: 'message', payload: {
        seq: urls.length, kind: 'text', role: 'agent', text: `TEST reply ${urls.length}`,
      } })])
    }))
    let latest: number[] = []
    for await (const snapshot of followThread(config, 'persistent', undefined, { reconnectOnEOF: true })) {
      latest = snapshot.messages.map((message) => message.seq as number)
      if (latest.includes(2)) break
    }
    expect(latest).toEqual([1, 2])
    expect(urls).toEqual([
      'https://staging.test/v1/threads/persistent/events?lastSeq=0',
      'https://staging.test/v1/threads/persistent/events?lastSeq=1',
    ])
  })

  it('does not reopen a persistent tail aborted during its reconnect delay', async () => {
    const fetch = vi.fn(async () => streamOf([]))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    for await (const snapshot of followThread(config, 'aborted-tail', controller.signal, { reconnectOnEOF: true })) {
      if (snapshot.error) controller.abort()
    }
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('resumes from the last token after socket death without loss or duplication', async () => {
    const urls: string[] = []
    let attempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        attempt += 1
        if (attempt === 1) {
          return streamOf([
            frame({ seq: 1, type: 'message', payload: { seq: 1, kind: 'text', role: 'agent', text: 'one' } }),
            frame({ seq: 2, type: 'delta', payload: { text: 'two', runKey: 'r:1' } }),
            'die',
          ])
        }
        return streamOf([
          frame({ seq: 3, type: 'message', payload: { seq: 3, kind: 'text', role: 'agent', text: 'three' } }),
        ])
      }),
    )
    const snapshots = await drain(followThread(config, 't-1'))
    expect(urls).toEqual([
      'https://staging.test/v1/threads/t-1/events?lastSeq=0',
      'https://staging.test/v1/threads/t-1/events?lastSeq=2',
    ])
    const last = snapshots[snapshots.length - 1]
    expect(last?.messages.map((message) => message.seq)).toEqual([1, 3])
    expect(last?.error).toBeNull()
  })

  it('reconnects a silent socket via the idle watchdog', async () => {
    const urls: string[] = []
    let attempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        attempt += 1
        if (attempt === 1) return hangingStream()
        return streamOf([
          frame({ seq: 1, type: 'message', payload: { seq: 1, kind: 'text', role: 'agent', text: 'late' } }),
        ])
      }),
    )
    const snapshots = await drain(followThread(config, 't-2', undefined, { idleTimeoutMs: 60 }))
    expect(urls).toHaveLength(2)
    expect(urls[1]).toBe('https://staging.test/v1/threads/t-2/events?lastSeq=0')
    const last = snapshots[snapshots.length - 1]
    expect(last?.messages.map((message) => message.seq)).toEqual([1])
  })

  it('skips malformed lines without killing the tail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('garbage line\n\n'))
            controller.enqueue(
              frame({ seq: 1, type: 'message', payload: { seq: 1, kind: 'text', role: 'agent', text: 'ok' } }),
            )
            controller.close()
          },
        })
        return { ok: true, status: 200, body: stream } as Response
      }),
    )
    const snapshots = await drain(followThread(config, 't-3'))
    const last = snapshots[snapshots.length - 1]
    expect(last?.messages.map((message) => message.seq)).toEqual([1])
    expect(last?.error).toBeNull()
  })
  it('hydrates overflow snapshots past hidden-only pages and clears obsolete thinking', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes('/steering-receipts?afterId=')) {
        return Response.json({ ok: true, data: url.includes('afterId=receipt-page') ? { items: [{ id: 'TEST missed', state: 'missed' }], nextAfterId: null } : { items: [{ id: 'TEST consumed', state: 'consumed' }], nextAfterId: 'receipt-page' } })
      }
      if (url.includes('/messages?afterSeq=0')) return Response.json({ ok: true, data: [], nextAfterSeq: 200 })
      if (url.includes('/messages?afterSeq=200')) return Response.json({ ok: true, data: [
        { seq: 201, kind: 'text', role: 'user', text: 'Question' },
        { seq: 202, kind: 'text', role: 'agent', text: 'Completed answer' },
      ], nextAfterSeq: 202 })
      if (url.includes('/messages?afterSeq=202')) return Response.json({ ok: true, data: [], nextAfterSeq: 202 })
      return streamOf([
        frame({ seq: 1, type: 'reasoning', payload: { runKey: 'old-run', text: 'Still thinking' } }),
        frame({ seq: 300, type: 'state', payload: { status: 'RUNNING', historyRefresh: true } }),
      ])
    }))
    const snapshots = await drain(followThread(config, 'overflow'))
    expect(snapshots.at(-1)).toMatchObject({ pendingReasoning: null, pendingTools: [], error: null })
    expect(snapshots.at(-1)?.messages.map((message) => message.seq)).toEqual([201, 202])
    expect(snapshots.at(-1)?.steering).toEqual([{ id: 'TEST consumed', state: 'consumed' }, { id: 'TEST missed', state: 'missed' }])
    expect(urls.filter((url) => url.includes('/messages')).map((url) => new URL(url).searchParams.get('afterSeq'))).toEqual(['0', '200', '202'])
  })

  it('retries hydration from the prior stream token when history cannot be read', async () => {
    let streams = 0, reads = 0
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes('/steering-receipts')) return Response.json({ ok: true, data: { items: [], nextAfterId: null } })
      if (url.includes('/messages')) {
        reads += 1
        if (reads === 1) return Response.json({ ok: false, error: { code: 'unavailable' } }, { status: 503 })
        return Response.json({ ok: true, data: [{ seq: 1, kind: 'text', role: 'agent', text: 'Recovered answer' }] })
      }
      streams += 1
      return streamOf([frame({ seq: 300, type: 'state', payload: { status: 'FINISHED', historyRefresh: true } })])
    }))
    const snapshots = await drain(followThread(config, 'overflow-retry'))
    expect(streams).toBe(2)
    expect(urls.filter((url) => url.includes('/events'))).toEqual([
      'https://staging.test/v1/threads/overflow-retry/events?lastSeq=0',
      'https://staging.test/v1/threads/overflow-retry/events?lastSeq=0',
    ])
    expect(snapshots.at(-1)?.messages[0]?.text).toBe('Recovered answer')
  })

  it('keeps a caller-owned cursor across graceful EOF follower replacement', async () => {
    const urls: string[] = [], cursor = { seq: 0 }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return streamOf(url.endsWith('lastSeq=0') ? [frame({ seq: 9, type: 'message', payload: { seq: 1, kind: 'text', role: 'agent', text: 'Done' } })] : [])
    }))
    await drain(followThread(config, 'eof', undefined, { cursor }))
    await drain(followThread(config, 'eof', undefined, { cursor }))
    expect(cursor.seq).toBe(9)
    expect(urls.map((url) => new URL(url).searchParams.get('lastSeq'))).toEqual(['0', '9'])
  })

  it('retains consumed steering and streamed prefixes across graceful EOF', async () => {
    const cursor = { seq: 0 }
    let attempt = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempt += 1
      return streamOf(attempt === 1 ? [
        frame({ seq: 1, type: 'steering-consumption', payload: { ids: ['TEST steer'], state: 'consumed' } }),
        frame({ seq: 2, type: 'delta', payload: { runKey: 'TEST run', text: 'Saved prefix ' } }),
      ] : [
        frame({ seq: 3, type: 'delta', payload: { runKey: 'TEST run', text: 'and suffix' } }),
        frame({ seq: 4, type: 'message', payload: { seq: 1, kind: 'text', role: 'agent', text: 'Final answer' } }),
      ])
    }))
    await drain(followThread(config, 'retained', undefined, { cursor }))
    const recovered = await drain(followThread(config, 'retained', undefined, { cursor }))
    expect(recovered[0]?.pendingText).toBe('Saved prefix and suffix')
    expect(recovered.at(-1)?.steering).toEqual([{ id: 'TEST steer', state: 'consumed' }])
    expect(recovered.at(-1)?.pendingText).toBeNull()
  })

  it.each(['FINISHED', 'ERROR', 'STOPPED', 'CANCELLING'])('drops in-flight deltas on a %s state frame', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf([
      frame({ seq: 1, type: 'tool', payload: { runKey: 'TEST run', id: 'TEST tool', name: 'search', state: 'running' } }),
      frame({ seq: 2, type: 'delta', payload: { runKey: 'TEST run', text: 'partial…' } }),
      frame({ seq: 3, type: 'state', payload: { status } }),
    ])))
    const snapshots = await drain(followThread(config, 'terminal-clear'))
    expect(snapshots[1]).toMatchObject({ pendingText: 'partial…' })
    expect(snapshots[1]?.pendingTools).toHaveLength(1)
    expect(snapshots.at(-1)).toMatchObject({ pendingText: null, pendingReasoning: null, pendingTools: [], threadStatus: status, error: null })
  })

})
