// MCP transport route (Phase 2). Thin Fastify wiring over backend/src/mcp/:
// API-key auth plus scope/role resolution here, one stateless Streamable
// HTTP exchange per request, tool logic in tools.ts, SQL only in the db
// layer. POST /mcp answers JSON (enableJsonResponse) and honors
// Idempotency-Key like every other mutation.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { verifyExecution } from '../auth/execution.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { resolveCaller, roleAtLeast, roleLevelAtLeast, type Role, type Scope } from '../auth/keys.js'
import type { TransactableDb } from '../db/index.js'
import { WorkspaceError, requireThread } from '../db/index.js'
import type { RunsGateway } from '../temporal/gateway.js'
import type { ArchiveTarget } from '../archive/targets.js'
import { childLogger } from '../observability/logging.js'
import { TOOL_NAMES, type McpToolName } from './schemas.js'
import { createMcpServer, toolCapability, TOOL_META, type ToolGrant } from './tools.js'
import { requirePool, route, sendError, withIdempotency, header } from '../routes/http.js'

/** API-key gate mirroring authorize(): open mode skips auth with full local
 * role; keyed mode denies absent/unknown/under-viewer callers with 403
 * permission_denied and returns the tenant/project scope plus role. */
async function authorizeMcp(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ scope: Scope | undefined; role: Role; keyId: string } | undefined> {
  const useAuth = (app as FastifyInstance & { kardataAuth?: boolean }).kardataAuth === true
  if (!useAuth) {
    request.kardataCaller = { keyId: 'open' }
    return { scope: undefined, role: 'approver', keyId: 'open' }
  }
  const pool = requirePool(app, reply)
  if (!pool) return undefined
  const result = await resolveCaller(pool, header(request, 'authorization'), header(request, 'x-tenant'), header(request, 'x-project'))
  if ('denied' in result) {
    void sendError(reply, 403, 'permission_denied', result.denied)
    return undefined
  }
  if (!roleAtLeast(result.caller, 'viewer')) {
    void sendError(reply, 403, 'permission_denied', `role ${result.caller.role} cannot perform this action`)
    return undefined
  }
  request.kardataCaller = { keyId: result.caller.keyId, tenantId: result.scope.tenantId }
  return { scope: result.scope, role: result.caller.role, keyId: result.caller.keyId }
}

export function mcpRoutes(app: FastifyInstance): void {
  route(app, 'post', '/mcp', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorizeMcp(app, request, reply)
    if (!auth) return undefined
    if (request.body === undefined) {
      return sendError(reply, 400, 'validation_failed', 'missing JSON-RPC body')
    }
    const body = request.body
    reply.header('content-type', 'application/json')
    const deps = app as FastifyInstance & { kardataRuns?: RunsGateway; kardataLogger?: Logger; kardataArchive?: ArchiveTarget }
    const threadKey = header(request, 'x-kardata-thread')
    const signature = header(request, 'x-kardata-execution')
    const workerToken = process.env['KARDATA_MCP_TOKEN']
    let executionThread: string | undefined
    if (threadKey || signature) {
      if (!threadKey || !signature || !workerToken || !verifyExecution(threadKey, signature, workerToken)) throw new WorkspaceError('permission_denied', 'Invalid execution binding.')
      executionThread = threadKey
      await requireThread(pool, executionThread, auth.scope)
    }
    const grantRaw = header(request, 'x-kardata-tool-grant')
    const grant: ToolGrant = {}
    if (grantRaw !== undefined) {
      const names = grantRaw.split(',').map((name) => name.trim()).filter(Boolean)
      const unknown = names.filter((name) => !(TOOL_NAMES as readonly string[]).includes(name))
      if (unknown.length) return sendError(reply, 400, 'validation_failed', `unknown tools in grant: ${unknown.slice(0, 5).join(', ')}`)
      grant.allow = new Set(names as McpToolName[])
    }
    const execute = () => serveMcp(request, reply, pool, auth, deps.kardataRuns, deps.kardataLogger, deps.kardataArchive, body, grant, executionThread)
    const rpc = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : undefined
    const params = typeof rpc?.['params'] === 'object' && rpc['params'] !== null ? rpc['params'] as Record<string, unknown> : undefined
    const name = params?.['name']
    const toolName = rpc?.['method'] === 'tools/call' && typeof name === 'string' && (TOOL_NAMES as readonly string[]).includes(name) ? name as McpToolName : undefined
    const cacheable = toolName !== undefined && toolCapability(toolName) !== 'read'
      && roleLevelAtLeast(auth.role, TOOL_META[toolName].minRole)
      && (grant.allow === undefined || grant.allow.has(toolName))
    // Reads and denied calls recheck current visibility/authority, not old replies.
    if (!rpc || !cacheable) {
      const result = await execute()
      return reply.code(result.status).send(result.body)
    }
    const requestId = rpc['id']
    const semantic = Object.fromEntries(Object.entries(rpc).filter(([key]) => key !== 'id'))
    return withIdempotency(request, reply, pool, auth.keyId, execute, {
      fingerprintBody: { version: 2, request: semantic, authority: { role: auth.role, scope: auth.scope, executionThread, grant: grant.allow ? [...grant.allow].sort() : null } },
      responseBody: (stored) => {
        if (typeof stored !== 'string' || !stored || (typeof requestId !== 'string' && typeof requestId !== 'number')) return stored
        const response = JSON.parse(stored) as Record<string, unknown>
        return JSON.stringify({ ...response, id: requestId })
      },
    })
  })
}

/** One stateless exchange against a grant-scoped server. Extracted so the
 * grant and no-grant paths share the transport setup. */
async function serveMcp(
  request: FastifyRequest,
  _reply: FastifyReply,
  pool: TransactableDb,
  auth: { scope: Scope | undefined; role: Role; keyId: string },
  runs: RunsGateway | undefined,
  logger: Logger | undefined,
  archive: ArchiveTarget | undefined,
  body: unknown,
  grant: ToolGrant,
  executionThread?: string,
): Promise<{ status: number; body: string; retrySafeBeforeEffect?: boolean }> {
  // Request-scoped tool logger carrying the ingress trace and tenant
  // join keys. Without a configured logger tools still run, but nothing
  // is recorded — the request never fails for observability's sake.
  const toolLogger = logger
    ? childLogger(logger, {
        ...(request.traceContext ? { traceId: request.traceContext.traceId } : {}),
        ...(request.kardataCaller?.tenantId ? { tenant: request.kardataCaller.tenantId } : {}),
      })
    : undefined
  // The runs gateway satisfies every runner interface structurally
  // (sweep starter, thread messenger, subagent delegator); absent runners
  // fail their tools closed instead of half-acting.
  const server = createMcpServer({ pool, scope: auth.scope, role: auth.role, keyId: auth.keyId, executionThread, ...(toolLogger ? { logger: toolLogger } : {}), ...(runs ? { runs, messenger: runs, delegator: runs, runReader: runs } : {}), ...(archive ? { archive } : {}) }, grant)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    headers.set('accept', 'application/json, text/event-stream')
    const webRequest = new Request('https://kardata.internal/mcp', { method: 'POST', headers })
    const response = await transport.handleRequest(webRequest, { parsedBody: body })
    const text = await response.text()
    const result = text ? JSON.parse(text) as { result?: { isError?: boolean; _meta?: Record<string, unknown> } } : undefined
    const retrySafeBeforeEffect = result?.result?.isError === true && result.result._meta?.['kardata/retry-safe-before-effect'] === true
    return { status: response.status, body: text, ...(retrySafeBeforeEffect ? { retrySafeBeforeEffect: true } : {}) }
  } finally {
    await server.close()
  }
}
