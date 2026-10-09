import { describe, expect, it, vi } from 'vitest'
import { frozenClock } from './clock.js'
import { IdempotencyLog } from './epochs.js'
import type { ToolCallRequest, ToolResult } from './providers.js'
import { BoundedQueue } from './queue.js'
import { dispatch, ToolRegistry, validateArgs, type ToolContext } from './tools.js'

function ctx(): ToolContext {
  return {
    toolCallId: 'c1',
    toolName: 'echo',
    clock: frozenClock(0),
    signal: new AbortController().signal,
  }
}

function call(name: string, args: Record<string, unknown> = {}, id = 'c1'): ToolCallRequest {
  return { id, name, args }
}

function echoRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    definition: {
      name: 'echo',
      description: 'echo back',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    handler: (args) => Promise.resolve({ content: String(args['text']) }),
  })
  return registry
}

describe('validateArgs [F:agents.tools.validateArgs]', () => {
  it('accepts valid args and reports missing, unknown, mistyped, off-enum', () => {
    const registry = echoRegistry()
    const definition = registry.get('echo')?.definition
    if (!definition) throw new Error('missing fixture tool')
    expect(validateArgs(definition, { text: 'hi' })).toEqual([])
    expect(validateArgs(definition, {})).toContain("missing required argument 'text'")
    expect(validateArgs(definition, { text: 'hi', bogus: 1 })).toContain("unknown argument 'bogus'")
    expect(validateArgs(definition, { text: 5 })).toContain("argument 'text' must be string")
  })

  it('enforces enums', () => {
    expect(
      validateArgs(
        {
          name: 'm',
          description: 'm',
          parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } },
        },
        { mode: 'c' },
      ),
    ).toContain('argument \'mode\' must be one of a, b')
  })
})

describe('dispatch [F:agents.tools.dispatch] [F:agents.tools.ToolRegistry]', () => {
  it('executes and returns content results', async () => {
    const result = await dispatch(echoRegistry(), call('echo', { text: 'hi' }), ctx())
    expect(result).toMatchObject({ toolCallId: 'c1', toolName: 'echo', content: 'hi', isError: false })
  })

  it('turns unknown tools, bad args, and handler throws into error results', async () => {
    const registry = echoRegistry()
    registry.register({
      definition: { name: 'boom', description: 'b', parameters: { type: 'object' } },
      handler: () => Promise.reject(new Error('kaput')),
    })
    expect((await dispatch(registry, call('nope'), ctx())).isError).toBe(true)
    const badArgs = await dispatch(registry, call('echo', {}), ctx())
    expect(badArgs.isError).toBe(true)
    expect(badArgs.content).toContain('missing required')
    const failed = await dispatch(registry, call('boom'), ctx())
    expect(failed.isError).toBe(true)
    expect(failed.content).toContain('kaput')
  })

  it('pauses privileged tools for approval: approve, edit, reject, missing gate', async () => {
    const registry = new ToolRegistry()
    registry.register({
      definition: {
        name: 'write',
        description: 'w',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
      },
      handler: (args) => Promise.resolve({ content: `wrote:${String(args['text'])}` }),
      requiresApproval: true,
    })
    const missing = await dispatch(registry, call('write', { text: 'a' }), ctx())
    expect(missing.isError).toBe(true)
    expect(missing.content).toContain('no gate')

    const approve = await dispatch(registry, call('write', { text: 'a' }), ctx(), {
      gate: { request: () => Promise.resolve({ verdict: 'approve' }) },
    })
    expect(approve.content).toBe('wrote:a')

    const edit = await dispatch(registry, call('write', { text: 'a' }), ctx(), {
      gate: { request: () => Promise.resolve({ verdict: 'edit', args: { text: 'b' } }) },
    })
    expect(edit.content).toBe('wrote:b')

    const reject = await dispatch(registry, call('write', { text: 'a' }), ctx(), {
      gate: { request: () => Promise.resolve({ verdict: 'reject', reason: 'not now' }) },
    })
    expect(reject.isError).toBe(true)
    expect(reject.content).toContain('not now')
  })

  it('times out slowly handlers and aborts their signal', async () => {
    let aborted = false
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'slow', description: 's', parameters: { type: 'object' } },
      handler: (_args, handlerCtx) =>
        new Promise<{ content: string }>((resolve) => {
          handlerCtx.signal.addEventListener('abort', () => {
            aborted = true
            resolve({ content: 'late' })
          })
        }),
    })
    let fire: () => void = () => {}
    const setTimeoutFn = ((fn: () => void) => {
      fire = fn
      return 1 as unknown as NodeJS.Timeout
    }) as typeof setTimeout
    const pending = dispatch(registry, call('slow'), ctx(), { timeoutMs: 100, setTimeoutFn })
    fire()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content).toContain('timed out after 100ms')
    expect(aborted).toBe(true)
  })

  it('returns recorded results for repeated idempotency keys, executes without keys', async () => {
    const handler = vi.fn((args: Record<string, unknown>) =>
      Promise.resolve({ content: String(args['text']) }),
    )
    const registry = new ToolRegistry()
    registry.register({
      definition: {
        name: 'echo',
        description: 'e',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
      },
      handler,
    })
    const executions = new IdempotencyLog()
    const results = new Map<string, ToolResult>()
    const options = { idempotencyKey: 'write:a.ts', executions, results }
    const first = await dispatch(registry, call('echo', { text: 'x' }, 'c1'), ctx(), options)
    const second = await dispatch(registry, call('echo', { text: 'x' }, 'c2'), ctx(), options)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)

    // No key: legitimate repeats always execute.
    await dispatch(registry, call('echo', { text: 'x' }, 'c3'), ctx())
    await dispatch(registry, call('echo', { text: 'x' }, 'c4'), ctx())
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('propagates outer cancellation to the handler signal', async () => {
    let seen = false
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'wait', description: 'w', parameters: { type: 'object' } },
      handler: (_args, handlerCtx) =>
        new Promise<{ content: string }>((resolve) => {
          handlerCtx.signal.addEventListener('abort', () => {
            seen = true
            resolve({ content: 'cancelled' })
          })
        }),
    })
    const controller = new AbortController()
    const pending = dispatch(
      registry,
      call('wait'),
      { toolCallId: 'c9', toolName: 'wait', clock: frozenClock(0), signal: controller.signal },
    )
    controller.abort()
    await pending
    expect(seen).toBe(true)
  })
})

describe('BoundedQueue [F:agents.queue.BoundedQueue]', () => {
  it('rejects past capacity with reason and keeps FIFO order', () => {
    const queue = new BoundedQueue<string>(2)
    expect(queue.enqueue('a')).toEqual({ ok: true })
    expect(queue.enqueue('b')).toEqual({ ok: true })
    const full = queue.enqueue('c')
    expect(full.ok).toBe(false)
    if (!full.ok) expect(full.reason).toContain('capacity 2')
    expect(queue.dequeue()).toBe('a')
    expect(queue.enqueue('c')).toEqual({ ok: true })
    expect(queue.drain()).toEqual(['b', 'c'])
    expect(queue.size).toBe(0)
  })
})
