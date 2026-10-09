import { Writable } from 'node:stream'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { childLogger, createLogger,createWorkerLogger,workerLoggingOptions, logOp, scrubSecrets } from '../../backend/src/observability/logging.js'
import { route } from '../../backend/src/routes/http.js'
import { extractTraceContext, injectTraceparent, newTraceId, tracePlugin } from '../../backend/src/observability/trace.js'

function capture(): { lines: string[]; stream: Writable } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) lines.push(line)
      }
      callback()
    },
  })
  return { lines, stream }
}

describe('logging contract (B0.5)', () => {
  it('forwards native diagnostics with correlation but without raw failure strings, entries, spans or message bodies',() => {
    const { lines,stream }=capture()
    const privateText='TEST private execution body and api_key=synthetic-secret'
    createWorkerLogger('INFO',stream).warn(`Failing workflow task ${privateText}`,{ sdkComponent: 'core',target: 'temporalio_sdk_core::worker::workflow',run_id: 'TEST-run',workflow_id: 'TEST-workflow',namespace: 'TEST-isolated',failure: `Failure { message: ${privateText}, stack_trace: ${privateText} }`,entry: privateText,spanContexts: [{ user: privateText }],taskToken: privateText })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(privateText)
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'temporal.native',sdkComponent: 'core',target: 'temporalio_sdk_core::worker::workflow',run_id: 'TEST-run',workflow_id: 'TEST-workflow',namespace: 'TEST-isolated',messageHash: expect.stringMatching(/^[a-f0-9]{64}$/),msg: 'Temporal native diagnostic' })
    expect(workerLoggingOptions()).toEqual({ filter: { core: 'WARN',other: 'ERROR' },forward: {} })
    createWorkerLogger('INFO',stream).error(`Error converting native log entry: ${privateText}`,{ error: new Error(privateText),entry: privateText })
    expect(lines[1]).not.toContain(privateText)
    expect(JSON.parse(lines[1]!)).toMatchObject({ event: 'temporal.native',msg: 'Temporal native diagnostic' })
  })
  it('keeps error identities while excluding sensitive error bodies and stacks', () => {
    const { lines, stream } = capture()
    const error = new Error('SECRET provider response body')
    createLogger({}, stream).error({ error, taskToken: 'SECRET activity token' }, 'Operation failed')
    expect(lines[0]).not.toContain('SECRET')
    expect(JSON.parse(lines[0]!)).toMatchObject({ error: { name: 'Error' }, taskToken: '[Redacted]' })
  })
  it('keeps verified numeric token counters observable while redacting token credentials', () => {
    expect(scrubSecrets({ inputTokens: 42, outputTokens: 7, cacheReadTokens: 20, accessToken: 'secret', input_tokens: 'secret-disguised-as-count' })).toEqual({ inputTokens: 42, outputTokens: 7, cacheReadTokens: 20, accessToken: '[Redacted]', input_tokens: '[Redacted]' })
  })
  it('handles cyclic metadata without recursion failure or secret leakage', () => {
    const metadata: Record<string, unknown> = { trace_id: 'trace-cycle', apiKey: 'cyclic-secret' }
    metadata['self'] = metadata
    expect(() => JSON.stringify(scrubSecrets(metadata))).not.toThrow()
    expect(JSON.stringify(scrubSecrets(metadata))).not.toContain('cyclic-secret')
  })
  it('every line carries the join keys', () => {
    const { lines, stream } = capture()
    const log = createLogger(
      { traceId: 'trace-1', runId: 'run-9', op: 'unit.run', attempt: 2, tenant: 't1' },
      stream,
    )
    log.info({ event: 'test' }, 'hello')
    childLogger(log, { op: 'tool.call' }).info('nested')
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed['trace_id']).toBe('trace-1')
      expect(parsed['run_id']).toBe('run-9')
      expect(parsed['tenant']).toBe('t1')
      expect(parsed['attempt']).toBe(2)
    }
    expect((JSON.parse(lines[1]) as Record<string, unknown>)['op']).toBe('tool.call')
  })

  it('scrub is fail-closed: listed keys and unlisted variants never leak', () => {
    const secret = 'sk-probe-secret-value'
    const scrubbed = scrubSecrets({
      apiKey: secret,
      nested: { api_key: secret, deep: [{ authorization: `Bearer ${secret}` }] },
      providerApiKey: secret, // unlisted long-form variant: still a secret
      sessionKey: secret,
      threadKey: 'agent:a2', // identifier, not a secret: stays visible
      message: 'nothing sensitive here',
    })
    const text = JSON.stringify(scrubbed)
    expect(text).not.toContain(secret)
    expect(text).toContain('[Redacted]')
    expect(text).toContain('agent:a2')
    expect(text).toContain('nothing sensitive here')
  })

  it('scrub applies at write time through the logger', () => {
    const { lines, stream } = capture()
    createLogger({ traceId: 't' }, stream).info({ apiKey: 'sk-probe-secret-value', ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('sk-probe-secret-value')
    expect(lines[0]).toContain('[Redacted]')
  })

  it('traceparent extracts, injects, and round-trips; garbage mints', () => {
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const context = extractTraceContext({ traceparent: incoming })
    expect(context).toEqual({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', parentSpanId: '00f067aa0ba902b7' })
    const outgoing = injectTraceparent(context)
    expect(extractTraceContext({ traceparent: outgoing })).toEqual(context)
    const minted = extractTraceContext({})
    expect(minted.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(minted.parentSpanId).toBeUndefined()
    expect(extractTraceContext({ traceparent: 'bogus' }).traceId).not.toBe(context.traceId)
  })

  it('new trace ids are 32 hex chars', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('emits the activity join keys in snake_case (P3.2.3)', () => {
    const { lines, stream } = capture()
    const logger = createLogger({ traceId: 'TEST trace', runId: 'TEST run', threadKey: 'TEST thread', sessionId: 'TEST session', sectorId: 'TEST sector', round: 3 }, stream)
    logger.info({ event: 'TEST.op' })
    const child = childLogger(createLogger({}, stream), { threadKey: 'TEST child thread', round: 4 })
    child.info({ event: 'TEST.child' })
    expect(JSON.parse(lines[0]!)).toMatchObject({ trace_id: 'TEST trace', run_id: 'TEST run', thread_key: 'TEST thread', session_id: 'TEST session', sector_id: 'TEST sector', round: 3 })
    expect(JSON.parse(lines[1]!)).toMatchObject({ thread_key: 'TEST child thread', round: 4 })
    expect(JSON.parse(lines[1]!)).not.toHaveProperty('trace_id')
  })

describe('logOp long-operation triple', () => {
  function parsed(lines: string[]): Array<Record<string, unknown>> {
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it('success emits start then done with outcome ok and latency', async () => {
    const { lines, stream } = capture()
    const log = createLogger({ traceId: 'trace-9', runId: 'run-3' }, stream)
    const result = await logOp(log, 'sector.start', async () => 'done-value', { sectorId: 'sec-1' })
    expect(result).toBe('done-value')
    const events = parsed(lines)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'sector.start.start', op: 'sector.start', sectorId: 'sec-1' })
    expect(events[1]).toMatchObject({ event: 'sector.start.done', op: 'sector.start', outcome: 'ok', sectorId: 'sec-1' })
    expect(typeof events[1]['latencyMs']).toBe('number')
    for (const event of events) {
      expect(event['trace_id']).toBe('trace-9')
      expect(event['run_id']).toBe('run-3')
    }
  })

  it('failure emits an error line with the error code and rethrows', async () => {
    const { lines, stream } = capture()
    const log = createLogger({ traceId: 'trace-9' }, stream)
    const failure = await logOp(log, 'tool.call', async () => {
      throw new TypeError('boom')
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(TypeError)
    const events = parsed(lines)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'tool.call.start', op: 'tool.call' })
    expect(events[1]).toMatchObject({ event: 'tool.call.error', op: 'tool.call', outcome: 'error', code: 'TypeError' })
    expect(typeof events[1]['latencyMs']).toBe('number')
  })

  it('extra fields are scrubbed like every other log line', async () => {
    const { lines, stream } = capture()
    const log = createLogger({}, stream)
    await logOp(log, 'op', async () => undefined, { apiKey: 'shh-secret-value' })
    expect(lines.join('\n')).not.toContain('shh-secret-value')
  })
})

  it('fastify ingress joins request logs to the incoming trace', async () => {
    const { lines, stream } = capture()
    const app = Fastify({ logger: false })
    await app.register(tracePlugin)
    app.get('/ping', async (request) => {
      createLogger({ traceId: request.traceContext.traceId }, stream).info('ping')
      return { ok: true as const }
    })
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const response = await app.inject({ method: 'GET', url: '/ping', headers: { traceparent: incoming } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['traceparent']).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-/)
    expect(lines).toHaveLength(1)
    expect((JSON.parse(lines[0]) as Record<string, unknown>)['trace_id']).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    )
    await app.close()
  })

  it('route errors log route plus trace join keys beside the envelope', async () => {
    const { lines, stream } = capture()
    const app = Fastify({ logger: false })
    await app.register(tracePlugin)
    ;(app as FastifyInstance & { kardataLogger?: unknown }).kardataLogger = createLogger({}, stream)
    route(app, 'get', '/boom', async () => {
      throw new Error('kaboom')
    })
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const response = await app.inject({ method: 'GET', url: '/boom', headers: { traceparent: incoming } })
    expect(response.statusCode).toBe(500)
    expect((response.json() as { error: { code: string } }).error.code).toBe('overload')
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      event: 'http.route.error',
      route: 'GET /boom',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      code: 'internal',
    })
    await app.close()
  })
})
