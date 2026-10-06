// Temporal OTel wiring (P3.2). No server: the context manager, propagator,
// and interceptor factories the gateway and worker factory share. Trace
// continuity itself is proven by the [temporal] end-to-end test once the
// activity log fields (3.2.3) and event columns (3.2.6) land.
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  activeTraceId,
  activityLogContext,
  activityLogFields,
  ambientTraceparent,
  ensureTemporalTracing,
  temporalActivityInfo,
  temporalActivityInterceptorFactories,
  temporalClientInterceptors,
  temporalWorkflowExportSinks,
  temporalWorkflowModules,
  withAmbientTrace,
  withTraceContext,
} from '../../backend/src/observability/temporal-tracing.js'

const TRACE_ID = 'a'.repeat(32)

describe('ensureTemporalTracing (P3.2)', () => {
  it('registers once and tolerates repeats', () => {
    expect(() => ensureTemporalTracing()).not.toThrow()
    expect(() => ensureTemporalTracing()).not.toThrow()
  })
})

describe('trace context helpers (P3.2)', () => {
  it('round-trips a trace id through the ambient OTel context', () => {
    ensureTemporalTracing()
    expect(withTraceContext(TRACE_ID, () => activeTraceId())).toBe(TRACE_ID)
  })

  it('reports no ambient trace outside a context', () => {
    ensureTemporalTracing()
    expect(activeTraceId()).toBeUndefined()
  })

  it('reuses the ambient trace instead of minting', () => {
    ensureTemporalTracing()
    expect(withTraceContext(TRACE_ID, () => withAmbientTrace(() => activeTraceId()))).toBe(TRACE_ID)
  })

  it('mints a fresh 32-hex trace id with no ambient trace', () => {
    ensureTemporalTracing()
    const minted = withAmbientTrace(() => activeTraceId())
    expect(minted).toMatch(/^[0-9a-f]{32}$/)
  })

  it('emits a W3C traceparent for the ambient trace, none outside it (P3.2.5)', () => {
    ensureTemporalTracing()
    expect(ambientTraceparent()).toBeUndefined()
    const header = withTraceContext(TRACE_ID, () => ambientTraceparent())
    expect(header).toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-01$/)
  })
})

describe('activity join keys (P3.2.3)', () => {
  it('reads no Temporal identity outside a worker', () => {
    expect(temporalActivityInfo()).toEqual({})
  })

  it('builds logger context with the ambient trace plus passed ids', () => {
    ensureTemporalTracing()
    const context = withTraceContext(TRACE_ID, () =>
      activityLogContext({ threadKey: 'TEST thread', sessionId: 'TEST session', sectorId: 'TEST sector', round: 3 }),
    )
    expect(context).toEqual({
      traceId: TRACE_ID,
      threadKey: 'TEST thread',
      sessionId: 'TEST session',
      sectorId: 'TEST sector',
      round: 3,
    })
  })

  it('omits unknown keys instead of emitting empties', () => {
    ensureTemporalTracing()
    expect(activityLogContext()).toEqual({})
    expect(activityLogFields({ sessionId: 'TEST session' })).toEqual({ session_id: 'TEST session' })
  })

  it('emits the same keys in snake_case for extras', () => {
    ensureTemporalTracing()
    const fields = withTraceContext(TRACE_ID, () =>
      activityLogFields({ threadKey: 'TEST thread', sessionId: 'TEST session', sectorId: 'TEST sector', round: 3 }),
    )
    expect(fields).toEqual({
      trace_id: TRACE_ID,
      thread_key: 'TEST thread',
      session_id: 'TEST session',
      sector_id: 'TEST sector',
      round: 3,
    })
  })

  it('lets explicit run and attempt override the ambient activity', () => {
    ensureTemporalTracing()
    expect(activityLogFields({ runId: 'TEST run', attempt: 2 })).toEqual({ run_id: 'TEST run', attempt: 2 })
  })
})

describe('interceptor factories (P3.2)', () => {
  it('builds one workflow client interceptor', () => {
    const interceptors = temporalClientInterceptors()
    expect(interceptors).toHaveLength(1)
    expect(typeof interceptors[0]?.start).toBe('function')
  })

  it('builds activity inbound/outbound interceptors per context', () => {
    const factories = temporalActivityInterceptorFactories()
    expect(factories).toHaveLength(1)
    const pair = factories[0]?.({} as never)
    expect(typeof pair?.inbound?.execute).toBe('function')
    expect(typeof pair?.outbound?.getLogAttributes).toBe('function')
  })

  it('resolves the workflow interceptor module to a real file', () => {
    const modules = temporalWorkflowModules()
    expect(modules).toHaveLength(1)
    expect(existsSync(modules[0] as string)).toBe(true)
  })

  it('builds a workflow-span exporter sink', () => {
    const sinks = temporalWorkflowExportSinks({ info: () => undefined } as never, 'TEST')
    expect(typeof (sinks.exporter as unknown as { export: { fn: unknown } }).export.fn).toBe('function')
  })
})
