// Worker MCP boot self-check (moved from turn.ts: turn.ts owns turn
// execution; the credential probe is worker startup, not a turn).
export interface McpAuthProbe {
  endpoint: string
  fetchFn: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number }>
}

/** Boot self-check: verifies the worker's MCP credential resolves before
 * polling, so a rotated-but-not-recreated token fails loudly here instead
 * of as cryptic per-turn 403s. Pure outcome, never throws, never carries
 * the token anywhere except the request header. Workers keep polling on a
 * negative result (tool-less turns still answer from digests); the log line
 * is the signal, and it names the remediation. */
export async function checkWorkerMcpAuth(input: {
  mcpEndpoint?: string
  mcpToken?: string
  threadKey?: string
  fetchFn?: McpAuthProbe['fetchFn']
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const endpoint = input.mcpEndpoint ?? process.env['KARDATA_MCP_URL']
  const token = input.mcpToken ?? process.env['KARDATA_MCP_TOKEN']
  if (!endpoint || !token) {
    return { ok: false, reason: 'mcp unconfigured (KARDATA_MCP_URL/TOKEN absent): turns run without tools' }
  }
  const fetchFn = input.fetchFn ?? fetch
  let status: number
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'karbot-turn', version: '3' } },
      }),
    })
    status = response.status
    if (response.ok) return { ok: true }
  } catch {
    return { ok: false, reason: `mcp unreachable at the worker endpoint: turns run without tools` }
  }
  if (status === 403) {
    return {
      ok: false,
      reason:
        'mcp credential rejected (HTTP 403): the worker token does not resolve. ' +
        'Recreate the worker after rotating agents/.env (docker compose up -d --force-recreate worker); ' +
        'a restart alone keeps the stale credential. Tool-requiring turns will fail until then.',
    }
  }
  return { ok: false, reason: `mcp healthcheck failed (HTTP ${status}): turns run without tools` }
}
