// MCP transport route (Phase 2). Thin Fastify wiring over backend/src/mcp/:
// API-key auth plus scope/role resolution here, one stateless Streamable
// HTTP exchange per request, tool logic in tools.ts, SQL only in the db
// layer. POST /mcp answers JSON (enableJsonResponse) and honors
// Idempotency-Key like every other mutation.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { resolveCaller, roleAtLeast, type Role, type Scope } from '../auth/keys.js'
import type { TransactableDb } from '../db/index.js'
import type { RunsGateway } from '../temporal/gateway.js'
import type { ArchiveTarget } from '../archive/targets.js'
import { childLogger } from '../observability/logging.js'
import { TOOL_NAMES, type McpToolName } from './schemas.js'
import { createMcpServer, type ToolGrant } from './tools.js'
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
    // Raw JSON-RPC passthrough: the idempotency wrapper replays the exact
    // response text, so the content type is fixed up front for both paths.
    reply.header('content-type', 'application/json')
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      const deps = app as FastifyInstance & { kardataRuns?: RunsGateway; kardataLogger?: Logger; kardataArchive?: ArchiveTarget }
      const runs = deps.kardataRuns
      // Worker-narrowed tool grant (x-kardata-tool-grant): the worker sends
      // its effective palette (product ∩ sector ∩ skill) so the server
      // enforces the same boundary the turn prompt was shaped with. Unknown
      // names fail the request loudly; known names still face role floors
      // per call, so a grant narrows but never widens.
      const grantRaw = header(request, 'x-kardata-tool-grant')
      if (grantRaw !== undefined) {
        const names = grantRaw.split(',').map((name) => name.trim()).filter((name) => name.length > 0)
        const known = new Set<string>(TOOL_NAMES)
        const unknown = names.filter((name) => !known.has(name))
        if (unknown.length > 0) {
          // Envelope returned directly (not sendError): the idempotency
          // wrapper owns the reply for this callback shape.
          return {
            status: 400,
            body: {
              ok: false,
              error: { code: 'validation_failed', message: `unknown tools in grant: ${unknown.slice(0, 5).join(', ')}` },
            },
          }
        }
        const grant: ToolGrant = { allow: new Set(names as McpToolName[]) }
        return serveMcp(request, reply, pool, auth, runs, deps.kardataLogger, deps.kardataArchive, body, grant)
      }
      return serveMcp(request, reply, pool, auth, runs, deps.kardataLogger, deps.kardataArchive, body, {})
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
): Promise<{ status: number; body: string }> {
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
  const server = createMcpServer({ pool, scope: auth.scope, role: auth.role, keyId: auth.keyId, ...(toolLogger ? { logger: toolLogger } : {}), ...(runs ? { runs, messenger: runs, delegator: runs } : {}), ...(archive ? { archive } : {}) }, grant)
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
    return { status: response.status, body: await response.text() }
  } finally {
    await server.close()
  }
}
