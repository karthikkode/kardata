// Local OpenAI-wire stub endpoint for integration tests. T2.6. Serves
// scripted scenarios over real HTTP so adapters prove the full path: real
// fetch, real SSE parsing, real status mapping. CI-local, zero network.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export type StubScenario =
  | { kind: 'json'; body: unknown; status?: number }
  | { kind: 'sse'; chunks: string[] }
  | { kind: 'flaky'; failStatus: number; body: unknown }

export interface StubEndpoint {
  url: string
  requests: Array<{ path: string; body: unknown }>
  close(): Promise<void>
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let text = ''
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString()
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'))
      } catch {
        resolve(text)
      }
    })
  })
}

export async function startStubEndpoint(scenarios: Record<string, StubScenario>): Promise<StubEndpoint> {
  const requests: StubEndpoint['requests'] = []
  const hits = new Map<string, number>()
  const server: Server = createServer((request, response: ServerResponse) => {
    void (async () => {
      const path = request.url ?? '/'
      const body = await readBody(request)
      requests.push({ path, body })
      const scenario = scenarios[path]
      if (!scenario) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end('{}')
        return
      }
      if (scenario.kind === 'json') {
        response.writeHead(scenario.status ?? 200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(scenario.body))
      } else if (scenario.kind === 'sse') {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const chunk of scenario.chunks) {
          response.write(`${chunk}\n\n`)
        }
        response.end('data: [DONE]\n\n')
      } else {
        const count = (hits.get(path) ?? 0) + 1
        hits.set(path, count)
        if (count === 1) {
          response.writeHead(scenario.failStatus, { 'content-type': 'application/json' })
          response.end('{}')
        } else {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify(scenario.body))
        }
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Stub server failed to bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
