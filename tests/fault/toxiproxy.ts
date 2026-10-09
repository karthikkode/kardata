// Minimal Toxiproxy v2 client for fault drills. Tests-only: global fetch is
// banned in backend src (eslint) but allowed here. The server is provisioned
// by `npm run stack:toxi -- up` (docker, host network, admin 127.0.0.1:8474)
// and consumed via TOXIPROXY_URL; drills skip without it.
export const TOXIPROXY_URL = process.env['TOXIPROXY_URL'] ?? ''
export const TOXI_PG_PORT = 15433
export const TOXI_TEMPORAL_PORT = 17233

async function toxi(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${TOXIPROXY_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`toxiproxy ${init?.method ?? 'GET'} ${path}: ${response.status} ${body.slice(0, 200)}`)
  }
  const text = await response.text()
  return text ? (JSON.parse(text) as unknown) : undefined
}

export async function createProxy(name: string, listenPort: number, upstreamHost: string, upstreamPort: number): Promise<void> {
  await toxi('/proxies', {
    method: 'POST',
    body: JSON.stringify({ name, listen: `127.0.0.1:${listenPort}`, upstream: `${upstreamHost}:${upstreamPort}` }),
  })
}

export async function deleteProxy(name: string): Promise<void> {
  try {
    await toxi(`/proxies/${encodeURIComponent(name)}`, { method: 'DELETE' })
  } catch (error) {
    if (!String((error as Error).message).includes(': 404 ')) throw error
  }
}

export async function setProxyEnabled(name: string, enabled: boolean): Promise<void> {
  await toxi(`/proxies/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify({ enabled }) })
}

export async function addToxic(
  proxy: string,
  toxic: { name: string; type: string; toxicity?: number; attributes?: Record<string, unknown> },
): Promise<void> {
  await toxi(`/proxies/${encodeURIComponent(proxy)}/toxics`, {
    method: 'POST',
    body: JSON.stringify({ toxicity: 1, ...toxic }),
  })
}

export async function removeToxic(proxy: string, toxic: string): Promise<void> {
  try {
    await toxi(`/proxies/${encodeURIComponent(proxy)}/toxics/${encodeURIComponent(toxic)}`, { method: 'DELETE' })
  } catch (error) {
    if (!String((error as Error).message).includes(': 404 ')) throw error
  }
}

/** Rewrite a postgres URL onto a proxy listen port, keeping user/db/query. */
export function proxiedPostgresUrl(base: string, port: number): string {
  const url = new URL(base)
  url.hostname = '127.0.0.1'
  url.port = String(port)
  return url.toString()
}

export function upstreamOf(base: string, defaultPort: number): { host: string; port: number } {
  const url = new URL(base)
  return { host: url.hostname, port: url.port ? Number(url.port) : defaultPort }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
