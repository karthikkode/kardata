// Sector/artifact client proof (F-S1). Hermetic fetch stub: asserts
// paths, methods, and bodies, plus the StagingApiError envelope mapping.
// Live-backend coverage extends tests/frontend/staging-api.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelRun, sendThreadText, steerThread } from '../../frontend/src/data/api/commands.js'
import { followThread, type StreamFrame } from '../../frontend/src/data/api/live.js'
import { renameSession } from '../../frontend/src/data/api/sessions.js'
import { getArtifactBody, listTenantArtifacts, referenceArtifact } from '../../frontend/src/data/api/artifacts.js'
import { getSectorDetail, listSectors, restartSector } from '../../frontend/src/data/api/sectors.js'
import { listCompanies } from '../../frontend/src/data/api/companies.js'
import { listRuns } from '../../frontend/src/data/api/runs.js'
import { StagingApiError, type StagingConfig } from '../../frontend/src/data/api/client.js'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

function stubFetch(payload: unknown, status = 200): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
      }
    }),
  )
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sector staging client (F-S1)', () => {
  it('lists sectors with filters encoded', async () => {
    const { calls } = stubFetch({ ok: true, data: [] })
    await expect(listSectors(config, { state: 'running', query: 'pet' })).resolves.toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://staging.test/v1/sectors?state=running&query=pet')
    expect(calls[0]?.init.method).toBe('GET')
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer key')
  })

  it('fetches one sector detail and restarts it', async () => {
    const detail = { ok: true, data: { id: 's1', companies: [], activity: [] } }
    const { calls } = stubFetch(detail)
    await expect(getSectorDetail(config, 's/1')).resolves.toEqual(detail.data)
    expect(calls[0]?.url).toBe('https://staging.test/v1/sectors/s%2F1')

    stubFetch({ ok: true, data: { id: 's1', state: 'running' } })
    const restarted = await restartSector(config, 's1')
    expect(restarted).toMatchObject({ id: 's1', state: 'running' })
  })

  it('lists companies scoped to a sector', async () => {
    const { calls } = stubFetch({ ok: true, data: [] })
    await listCompanies(config, { sectorId: 's1', state: 'paused' })
    expect(calls[0]?.url).toBe('https://staging.test/v1/companies?state=paused&sectorId=s1')
  })

  it('references and reads artifact bodies', async () => {
    stubFetch({ ok: true, data: { artifactId: 'art-1', indexed: true } })
    const ref = await referenceArtifact(config, 'sess', 'art-1', { kind: 'session', id: 'other' })
    expect(ref).toMatchObject({ artifactId: 'art-1' })

    stubFetch({ ok: true, data: { body: 'bytes', meta: {} } })
    await expect(getArtifactBody(config, 'sess', 'art-1')).resolves.toMatchObject({ body: 'bytes' })

    stubFetch({ ok: true, data: [] })
    await expect(listTenantArtifacts(config)).resolves.toEqual([])
  })

  it('maps error envelopes to StagingApiError', async () => {
    stubFetch({ ok: false, error: { code: 'not_found', message: 'no such sector nope' } }, 404)
    const error = await getSectorDetail(config, 'nope').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StagingApiError)
    expect(error as StagingApiError).toMatchObject({ status: 404, code: 'not_found' })
  })
})

function sseResponse(frames: StreamFrame[]): Response {
  const bytes = new TextEncoder().encode(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
  )
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream } as Response
}

const AGENT_MESSAGE = {
  id: 'm-1',
  role: 'agent',
  kind: 'text',
  text: 'hello',
  at: '2026-09-25T00:00:00.000Z',
}

describe('followThread (F-S3)', () => {
  it('shows tool start and completion before persisted rows arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { seq: 1, threadKey: 't', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'running' } },
      { seq: 2, threadKey: 't', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'done' } },
      { seq: 3, threadKey: 't', type: 'message', at: '', payload: { seq: 1, kind: 'tool', name: 'db.list_sectors', state: 'done' } },
    ])))
    const seen = []
    for await (const snapshot of followThread(config, 't')) seen.push(snapshot)
    expect(seen.map((snapshot) => snapshot.pendingTools.map((tool) => tool.state))).toEqual([
      ['running'], ['done'], [],
    ])
    expect(seen[2]?.messages[0]?.name).toBe('db.list_sectors')
  })
  it('replaces pre-tool chatter when a new model round starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { seq: 1, threadKey: 't', type: 'delta', at: '', payload: { runKey: 'r:1', text: 'Checking...' } },
      { seq: 2, threadKey: 't', type: 'delta', at: '', payload: { runKey: 'r:2', text: 'Here is the answer.' } },
    ])))
    const seen = []
    for await (const snapshot of followThread(config, 't')) seen.push(snapshot)
    expect(seen.map((snapshot) => snapshot.pendingText)).toEqual(['Checking...', 'Here is the answer.'])
  })
  it('accumulates deltas as pending text, cleared by the terminal message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { seq: 1, threadKey: 't', type: 'delta', at: '', payload: { runKey: 'r', text: 'he' } },
          { seq: 2, threadKey: 't', type: 'delta', at: '', payload: { runKey: 'r', text: 'llo' } },
          { seq: 3, threadKey: 't', type: 'message', at: '', payload: AGENT_MESSAGE },
        ]),
      ),
    )
    const seen = []
    for await (const snapshot of followThread(config, 't')) seen.push(snapshot)
    expect(seen.map((snapshot) => snapshot.pendingText)).toEqual(['he', 'hello', null])
    expect(seen[seen.length - 1]?.messages).toHaveLength(1)
    expect(seen[seen.length - 1]?.error).toBeNull()
  })

  it('resumes from the last token with persisted messages only', async () => {
    const calls: string[] = []
    const deltaBytes = new TextEncoder().encode(
      [
        { seq: 1, threadKey: 't', type: 'delta', at: '', payload: { runKey: 'r', text: 'he' } },
        { seq: 2, threadKey: 't', type: 'delta', at: '', payload: { runKey: 'r', text: 'llo' } },
      ]
        .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
        .join(''),
    )
    let pulls = 0
    const dropAfterDeltas = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls === 1) {
          controller.enqueue(deltaBytes)
          return
        }
        controller.error(new Error('connection dropped'))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (calls.length === 1) return { ok: true, status: 200, body: dropAfterDeltas } as Response
        return sseResponse([
          { seq: 3, threadKey: 't', type: 'message', at: '', payload: AGENT_MESSAGE },
        ])
      }),
    )
    const seen = []
    for await (const snapshot of followThread(config, 't')) seen.push(snapshot)
    // Two deltas, one error snapshot, then the persisted message.
    expect(seen.map((snapshot) => snapshot.pendingText)).toEqual(['he', 'hello', 'hello', null])
    expect(seen[2]?.error).toBeInstanceOf(Error)
    expect(calls[1]).toContain('lastSeq=2')
    const last = seen[seen.length - 1]
    expect(last?.messages).toHaveLength(1)
    expect(last?.pendingText).toBeNull()
    expect(last?.error).toBeNull()
  }, 15000)

  it('reconnects a silent stream and delivers the missed terminal message', async () => {
    const calls: string[] = []
    const deltaBytes = new TextEncoder().encode(
      `data: ${JSON.stringify({ seq: 1, threadKey: 't', type: 'delta', at: '', payload: { runKey: 'r', text: 'Hey —' } })}\n\n`,
    )
    const silent = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(deltaBytes)
        // Never closes, never errors: the half-open socket the browser
        // hung on (the delta arrived, the terminal message never did).
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (calls.length === 1) return { ok: true, status: 200, body: silent } as Response
        return sseResponse([
          { seq: 2, threadKey: 't', type: 'message', at: '', payload: AGENT_MESSAGE },
        ])
      }),
    )
    const seen = []
    for await (const snapshot of followThread(config, 't', undefined, { idleTimeoutMs: 50 })) {
      seen.push(snapshot)
    }
    // Delta, then the idle error (pending preserved), then the replayed
    // terminal message clears the replying state.
    expect(seen.map((snapshot) => snapshot.pendingText)).toEqual(['Hey —', 'Hey —', null])
    expect(seen[1]?.error).toBeInstanceOf(Error)
    expect(calls[1]).toContain('lastSeq=1')
    const last = seen[seen.length - 1]
    expect(last?.messages).toHaveLength(1)
    expect(last?.pendingText).toBeNull()
    expect(last?.error).toBeNull()
  }, 15000)
})

describe('command and run clients', () => {
  it('sends text to a thread with the command envelope', async () => {
    const { calls } = stubFetch({ ok: true, data: { commandId: 'cmd-1', state: 'accepted' } })
    await expect(sendThreadText(config, 'session-1', 'hello')).resolves.toEqual({
      commandId: 'cmd-1',
      state: 'accepted',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://staging.test/v1/commands/send')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ threadKey: 'session-1', text: 'hello' }))
  })

  it('steers a thread and surfaces missed_steer', async () => {
    const { calls } = stubFetch({ ok: true, data: { commandId: 'cmd-2', state: 'missed_steer' } })
    await expect(steerThread(config, 'agent:a1', 'wait')).resolves.toEqual({
      commandId: 'cmd-2',
      state: 'missed_steer',
    })
    expect(calls[0]?.url).toBe('https://staging.test/v1/commands/steer')
  })

  it('cancels a run by id', async () => {
    const { calls } = stubFetch({ ok: true, data: { commandId: 'cmd-3', state: 'accepted' } })
    await expect(cancelRun(config, 'session-run-9')).resolves.toEqual({
      commandId: 'cmd-3',
      state: 'accepted',
    })
    expect(calls[0]?.url).toBe('https://staging.test/v1/commands/cancel')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ runId: 'session-run-9' }))
  })

  it('lists runs with an optional session filter', async () => {
    const runs = [
      {
        id: 'session-run-9',
        sessionId: 's-1',
        threadKey: 's-1',
        state: 'RUNNING',
        budgetUsedRatio: 0,
        contextUsedRatio: 0,
        updatedAt: '2026-09-26T00:00:00.000Z',
      },
    ]
    const { calls } = stubFetch({ ok: true, data: runs })
    await expect(listRuns(config)).resolves.toEqual(runs)
    expect(calls[0]?.url).toBe('https://staging.test/v1/runs')
    await expect(listRuns(config, 's-1')).resolves.toEqual(runs)
    expect(calls[1]?.url).toBe('https://staging.test/v1/runs?sessionId=s-1')
  })

  it('renames a session with the title body', async () => {
    const { calls } = stubFetch({ ok: true, data: { id: 's-1', title: 'New name', createdAt: '', updatedAt: '' } })
    await expect(renameSession(config, 's-1', 'New name')).resolves.toEqual({
      id: 's-1',
      title: 'New name',
      createdAt: '',
      updatedAt: '',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://staging.test/v1/sessions/s-1/rename')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ title: 'New name' }))
  })

  it('maps command failures to StagingApiError', async () => {
    stubFetch({ ok: false, error: { code: 'not_found', message: 'no such thread' } }, 404)
    const error = await sendThreadText(config, 'gone', 'hi').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StagingApiError)
    expect((error as StagingApiError).status).toBe(404)
    expect((error as StagingApiError).code).toBe('not_found')
  })
})
