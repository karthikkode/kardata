// SSE resume proofs: followThread survives socket death, idle silence,
// and malformed frames without losing or duplicating messages, resuming
// from the last good token. fetch is stubbed per connection attempt.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followThread, type StagingConfig } from '@/data/staging-api'

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
  return { ok: true, status: 200, body: new ReadableStream<Uint8Array>(() => undefined) } as Response
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const snapshot of gen) out.push(snapshot)
  return out
}

describe('followThread resume', () => {
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
})
