// Typed tool registry, validation, dispatch with approvals, timeouts, and
// exactly-once execution. T3.1 + T3.4. Malformed calls become error
// tool-results, never exceptions: the model sees its own errors and corrects.
import type { Clock } from './clock.js'
import { IdempotencyLog } from './epochs.js'
import type { ToolCallRequest, ToolDefinition, ToolResult } from './providers.js'

export interface ToolContext {
  toolCallId: string
  toolName: string
  clock: Clock
  signal: AbortSignal
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<{ content: string; isError?: boolean }>

export type ApprovalVerdict =
  | { verdict: 'approve' }
  | { verdict: 'reject'; reason: string }
  | { verdict: 'edit'; args: Record<string, unknown> }

export interface ApprovalGate {
  request(call: ToolCallRequest): Promise<ApprovalVerdict>
}

export interface ToolRegistration {
  definition: ToolDefinition
  handler: ToolHandler
  /** Privileged tools pause for approval before executing. Default false. */
  requiresApproval?: boolean
}

function checkType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    default:
      return true
  }
}

// Minimal strict validator for our own schemas: required presence, property
// types, enums. Unknown keywords are ignored; schemas are Karbot-authored.
export function validateArgs(
  definition: ToolDefinition,
  args: Record<string, unknown>,
): string[] {
  const errors: string[] = []
  const schema = definition.parameters
  for (const name of schema.required ?? []) {
    if (!(name in args)) errors.push(`missing required argument '${name}'`)
  }
  for (const [name, value] of Object.entries(args)) {
    const prop = schema.properties?.[name]
    if (!prop) {
      errors.push(`unknown argument '${name}'`)
      continue
    }
    if (!checkType(value, prop.type)) {
      errors.push(`argument '${name}' must be ${prop.type}`)
      continue
    }
    if (prop.enum && !prop.enum.includes(String(value))) {
      errors.push(`argument '${name}' must be one of ${prop.enum.join(', ')}`)
    }
  }
  return errors
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolRegistration>()

  register(registration: ToolRegistration): void {
    this.tools.set(registration.definition.name, registration)
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name)
  }

  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition)
  }
}

export interface DispatchOptions {
  gate?: ApprovalGate
  timeoutMs?: number
  // Exactly-once scope: when the caller supplies a key (tool plus canonical
  // args plus scope), a repeated key returns the recorded result instead of
  // re-executing. Absent key always executes: legitimate repeats such as
  // status polls must not collide.
  idempotencyKey?: string
  executions?: IdempotencyLog
  results?: Map<string, ToolResult>
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

function errorResult(call: ToolCallRequest, content: string): ToolResult {
  return { toolCallId: call.id, toolName: call.name, content, isError: true }
}

export async function dispatch(
  registry: ToolRegistry,
  call: ToolCallRequest,
  ctx: ToolContext,
  options: DispatchOptions = {},
): Promise<ToolResult> {
  const registration = registry.get(call.name)
  if (!registration) {
    return errorResult(call, `unknown tool '${call.name}'`)
  }
  const argErrors = validateArgs(registration.definition, call.args)
  if (argErrors.length > 0) {
    return errorResult(call, `invalid arguments: ${argErrors.join('; ')}`)
  }
  let args = call.args
  if (registration.requiresApproval) {
    if (!options.gate) {
      return errorResult(call, `tool '${call.name}' requires approval and no gate is configured`)
    }
    const verdict = await options.gate.request({ ...call, args })
    if (verdict.verdict === 'reject') {
      return errorResult(call, `rejected by approval gate: ${verdict.reason}`)
    }
    if (verdict.verdict === 'edit') args = verdict.args
  }
  // Exactly-once: a repeated caller key returns the recorded result.
  const key = options.idempotencyKey
  if (key && options.executions?.has(key)) {
    const cached = options.results?.get(key)
    if (cached) return cached
    return errorResult(call, `duplicate execution of '${call.name}' blocked`)
  }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  ctx.signal.addEventListener('abort', onAbort, { once: true })
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutMs = options.timeoutMs
  try {
    const run = registration.handler(args, { ...ctx, signal: controller.signal })
    let result: { content: string; isError?: boolean }
    if (timeoutMs === undefined) {
      result = await run
    } else {
      let rejectTimeout: (error: Error) => void = () => {}
      const timeout = new Promise<never>((_, reject) => {
        rejectTimeout = reject
      })
      timer = setTimeoutFn(() => {
        // Reject first: the timeout verdict must win over a handler that
        // resolves while its abort signal is being delivered.
        rejectTimeout(new Error(`timed out after ${timeoutMs}ms`))
        controller.abort()
      }, timeoutMs)
      try {
        result = await Promise.race([run, timeout])
      } finally {
        clearTimeoutFn(timer)
      }
    }
    const toolResult: ToolResult = {
      toolCallId: call.id,
      toolName: call.name,
      content: result.content,
      isError: result.isError ?? false,
    }
    if (key) {
      options.executions?.record(key)
      options.results?.set(key, toolResult)
    }
    return toolResult
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('timed out after')) {
      return errorResult(call, error.message)
    }
    return errorResult(call, `tool '${call.name}' failed: ${String(error)}`)
  } finally {
    ctx.signal.removeEventListener('abort', onAbort)
  }
}
