// Planning tools: plan.create/update/add/list/block. T3.2. Single
// replace semantic (adopted write_todos shape): update replaces the whole
// list; discipline is enforced by errors, never prompts.
import type { ToolRegistration } from './tools.js'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface Todo {
  id: string
  content: string
  status: TodoStatus
}

export type PlanResult =
  | { ok: true; todos: Todo[] }
  | { ok: false; error: string }

function disciplineError(todos: Array<{ status: TodoStatus }>): string | undefined {
  const inProgress = todos.filter((todo) => todo.status === 'in_progress').length
  const allDone = todos.length > 0 && todos.every((todo) => todo.status === 'completed')
  if (todos.length === 0) return 'plan needs at least one item'
  if (!allDone && inProgress !== 1) {
    return `plan needs exactly one in_progress item unless all are completed (found ${inProgress})`
  }
  return undefined
}

function isStatus(value: unknown): value is TodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

/** Serializable plan state. The backend carries this through Temporal
 * workflows (durable in history) and rehydrates a store per tool activity,
 * so workers never hold plan state in process memory. */
export interface PlanSnapshot {
  todos: Todo[]
  nextId: number
}

export class PlanStore {
  private todos: Todo[] = []
  private nextId = 1

  snapshot(): PlanSnapshot {
    return { todos: this.list(), nextId: this.nextId }
  }

  restore(snapshot: PlanSnapshot): void {
    if (!Array.isArray(snapshot.todos) || !Number.isInteger(snapshot.nextId) || snapshot.nextId < 1) {
      throw new Error('invalid plan snapshot')
    }
    this.todos = snapshot.todos.map((todo) => ({ ...todo }))
    this.nextId = snapshot.nextId
  }

  create(items: Array<{ content: string; status: TodoStatus }>): PlanResult {
    const todos = items.map((item) => ({ id: `todo-${this.nextId++}`, ...item }))
    const error = disciplineError(todos)
    if (error) return { ok: false, error }
    this.todos = todos
    return { ok: true, todos: this.list() }
  }

  update(items: Array<{ content: string; status: TodoStatus }>): PlanResult {
    const todos = items.map((item) => ({ id: `todo-${this.nextId++}`, ...item }))
    const error = disciplineError(todos)
    if (error) return { ok: false, error }
    this.todos = todos
    return { ok: true, todos: this.list() }
  }

  add(content: string): PlanResult {
    if (!content.trim()) return { ok: false, error: 'plan item needs non-empty content' }
    this.todos.push({ id: `todo-${this.nextId++}`, content, status: 'pending' })
    return { ok: true, todos: this.list() }
  }

  block(id: string, reason: string): PlanResult {
    const item = this.todos.find((todo) => todo.id === id)
    if (!item) return { ok: false, error: `unknown plan item '${id}'` }
    if (!reason.trim()) return { ok: false, error: 'blocker needs a reason' }
    // Blocked work stays in_progress; the blocker is a new pending item.
    // Never mark complete when blocked.
    item.status = 'in_progress'
    this.todos.push({ id: `todo-${this.nextId++}`, content: `Blocker: ${reason}`, status: 'pending' })
    return { ok: true, todos: this.list() }
  }

  list(): Todo[] {
    return this.todos.map((todo) => ({ ...todo }))
  }
}

function readItems(args: Record<string, unknown>): Array<{ content: string; status: TodoStatus }> | string {
  const raw = args['todos']
  if (!Array.isArray(raw)) return 'todos must be an array'
  const out: Array<{ content: string; status: TodoStatus }> = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return 'each todo needs content and status'
    const record = entry as Record<string, unknown>
    if (typeof record['content'] !== 'string' || !isStatus(record['status'])) {
      return 'each todo needs content and status'
    }
    out.push({ content: record['content'], status: record['status'] })
  }
  return out
}

const TODOS_SCHEMA = {
  type: 'object' as const,
  properties: {
    todos: { type: 'array' as const },
  },
  required: ['todos'],
}

function resultText(result: PlanResult): { content: string; isError?: boolean } {
  if (!result.ok) return { content: result.error, isError: true }
  const lines = result.todos.map((todo) => `- [${todo.status}] ${todo.id}: ${todo.content}`)
  return { content: lines.join('\n') }
}

export function planTools(store: PlanStore): ToolRegistration[] {
  return [
    {
      definition: { name: 'plan.create', description: 'Create the task plan (first write).', parameters: TODOS_SCHEMA },
      handler: (args) => {
        const items = readItems(args)
        if (typeof items === 'string') return Promise.resolve({ content: items, isError: true })
        return Promise.resolve(resultText(store.create(items)))
      },
    },
    {
      definition: { name: 'plan.update', description: 'Replace the whole plan list.', parameters: TODOS_SCHEMA },
      handler: (args) => {
        const items = readItems(args)
        if (typeof items === 'string') return Promise.resolve({ content: items, isError: true })
        return Promise.resolve(resultText(store.update(items)))
      },
    },
    {
      definition: {
        name: 'plan.add',
        description: 'Append one pending plan item.',
        parameters: {
          type: 'object',
          properties: { content: { type: 'string' } },
          required: ['content'],
        },
      },
      handler: (args) => {
        if (typeof args['content'] !== 'string') {
          return Promise.resolve({ content: 'content must be a string', isError: true })
        }
        return Promise.resolve(resultText(store.add(args['content'])))
      },
    },
    {
      definition: {
        name: 'plan.block',
        description: 'Mark an item blocked: keeps it in progress, records the blocker.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' }, reason: { type: 'string' } },
          required: ['id', 'reason'],
        },
      },
      handler: (args) => {
        if (typeof args['id'] !== 'string' || typeof args['reason'] !== 'string') {
          return Promise.resolve({ content: 'id and reason must be strings', isError: true })
        }
        return Promise.resolve(resultText(store.block(args['id'], args['reason'])))
      },
    },
    {
      definition: { name: 'plan.list', description: 'Show the current plan.', parameters: { type: 'object' } },
      handler: () => Promise.resolve(resultText({ ok: true, todos: store.list() })),
    },
  ]
}

// Plan-write tool names share one discipline: at most one plan mutation per
// turn (adopted TodoListMiddleware after_model rule). The turn runner asks
// this hook which calls to suppress.
export const PLAN_WRITE_TOOLS = new Set(['plan.create', 'plan.update'])

export function suppressDuplicatePlanWrites(
  calls: Array<{ id: string; name: string }>,
): Map<string, string> {
  const suppressed = new Map<string, string>()
  const writes = calls.filter((call) => PLAN_WRITE_TOOLS.has(call.name))
  for (const extra of writes.slice(1)) {
    suppressed.set(extra.id, 'parallel plan writes rejected: one plan mutation per turn')
  }
  return suppressed
}
