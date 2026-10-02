import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { resolveCaller, roleAtLeast } from '../auth/keys.js'
import { listSupervisionAlerts } from '../db/index.js'
import { projectNewEvents } from '../projector.js'
import { header, parseInput, requirePool, route, sendError } from './http.js'

export function alertRoutes(app: FastifyInstance): void {
  route(app,'get','/v1/alerts',async (request,reply,app) => {
    const db=requirePool(app,reply)
    if (!db) return undefined
    // Notifications never use unscoped open-mode authority.
    const auth=await resolveCaller(db,header(request,'authorization'),header(request,'x-tenant'),header(request,'x-project'))
    if ('denied' in auth) return sendError(reply,403,'permission_denied',auth.denied)
    if (!roleAtLeast(auth.caller,'viewer')) return sendError(reply,403,'permission_denied','Alerts require a viewer key.')
    request.kardataCaller={keyId:auth.caller.keyId,tenantId:auth.scope.tenantId}
    const query=parseInput(z.object({ beforeSeq:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(Number.MAX_SAFE_INTEGER),limit:z.coerce.number().int().min(1).max(100).default(20) }).strict(),request.query,reply)
    if (!query) return undefined
    const projection=await projectNewEvents(db)
    if (!projection.caughtUp) return sendError(reply,503,'overload','Alert status is still catching up. Try again shortly.')
    return {ok:true,data:await listSupervisionAlerts(db,auth.scope,query.beforeSeq,query.limit)}
  })
}
