// Skill catalogue route: the chat slash picker lists registered product
// skills here. Read-only; viewer floor like other catalogue reads.
import type { FastifyInstance } from 'fastify'
import { listSkills } from '@kardata/agents'
import { authorize, route } from './http.js'

export function skillRoutes(app: FastifyInstance): void {
  route(app, 'get', '/v1/skills', async (request, reply, app) => {
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    return {
      ok: true,
      data: listSkills().map((skill) => ({
        name: skill.name,
        description: skill.description,
        tools: skill.tools,
      })),
    }
  })
}
