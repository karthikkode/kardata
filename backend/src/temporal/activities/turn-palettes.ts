// Turn tool palettes: PRODUCT/SECTOR/RESEARCH tool sets and the worker-edge
// wrappers that narrow an MCP client to one of them. Visibility only:
// the keyed MCP boundary still enforces role floors per call.
import { z } from 'zod'
import type { TurnRunnerMcpClient } from '@kardata/agents'

// The MCP server also exposes projector, auth, quota, and event-log plumbing.
// Those are operational APIs, not useful conversational tools. Keep Karbot's
// advertised palette small while preserving the full keyed MCP boundary for
// operators and other clients.
export const PRODUCT_TOOLS: ReadonlySet<string> = new Set([
  'db.commit_child_context',
  'db.get_global_context', 'db.propose_global_context', 'db.list_sector_files', 'db.propose_file_context', 'db.get_local_context',
  'db.get_sector_plan', 'db.get_research_progress', 'db.list_sector_sessions', 'db.read_sector_thread',
  'db.create_session',
  'db.list_sessions', 'db.get_session', 'db.get_thread', 'db.send_message', 'db.steer_thread', 'db.research_health',
  'db.pause_run', 'db.resume_run', 'db.cancel_run',
  'db.request_plan',
  'ops.list_runs', 'ops.get_run', 'ops.thread_queue', 'ops.queue_remove', 'ops.queue_reorder',
  'ops.list_alerts', 'ops.thread_health', 'ops.cost', 'ops.sector_evaluation', 'ops.recent_activity',
  'ops.pause_run', 'ops.resume_run', 'ops.cancel_run', 'ops.spawn_subagent', 'ops.restart_sector_research',
  'db.rename_session', 'db.delete_session',
  'db.list_sectors', 'db.get_sector', 'db.sector_activity',
  'db.list_companies', 'db.list_sector_companies',
  'db.create_sector', 'db.set_sector_state', 'db.start_sector_research', 'db.pause_sector_research', 'db.resume_sector_research', 'db.mark_company_found',
  'db.set_company_stage', 'db.set_company_state',
  'db.attach_sector_document', 'db.list_sector_documents', 'db.read_sector_document', 'db.query_document',
  'db.list_artifacts', 'db.create_artifact', 'db.list_tenant_artifacts', 'db.reference_artifact',
  'db.kb_search',
  'db.ledger_upsert_company', 'db.ledger_get_company', 'db.ledger_list_companies',
  'db.ledger_record_problem', 'db.ledger_list_problems',
  // Hound at fullest: live web search (keyed, else keyless pool), page
  // fetch with caps and SSRF guards, and the browser leg (sidecar CDP,
  // task-scoped sessions) when automated search is blocked. Keyed search
  // fails closed without KARDATA_WEB_SEARCH_KEY; every leg fails loudly,
  // never an empty list pretending to be exhaustive.
  'web_search', 'web_fetch',
  'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_close', 'browser_screenshot',
  // Delegation door (Karbot-only, operator): the main agent launches leaf
  // researchers by instruction. Steering launched children stays
  // approver-gated (send/steer), and pilot children never delegate
  // further (depth 0, maxDepth 0 at the gateway).
  'db.delegate_subagent',
])

export function productMcpClient(client: TurnRunnerMcpClient): TurnRunnerMcpClient {
  return {
    authorityId: client.authorityId,
    async listTools() {
      return (await client.listTools()).filter((tool) => PRODUCT_TOOLS.has(tool.name))
    },
    async callTool(name, args, operationId) {
      if (!PRODUCT_TOOLS.has(name)) return { content: `tool '${name}' is unavailable to Karbot`, isError: true }
      return client.callTool(name, args, operationId)
    },
  }
}

// Sector-chat palette: the same MCP, not all the access. Sector chats read
// their sector (plus session/thread/artifact context and the KB) and may
// attach context documents; cross-sector writes, tenant-wide reads, and
// ledger mutations stay Karbot-only. This is visibility at the worker edge:
// the keyed MCP boundary still enforces role floors per call.
export const SECTOR_TOOLS: ReadonlySet<string> = new Set([
  'db.commit_child_context',
  'db.delegate_subagent',
  'db.get_global_context', 'db.propose_global_context', 'db.list_sector_files', 'db.propose_file_context', 'db.get_local_context',
  'db.get_session',
  'db.get_thread',
  'db.get_sector',
  'db.list_sectors',
  'db.sector_activity',
  'db.list_companies',
  'db.list_sector_companies',
  'db.attach_sector_document',
  'db.list_sector_documents',
  'db.read_sector_document',
  'db.query_document',
  'db.list_artifacts',
  'db.create_artifact',
  'db.reference_artifact',
  'db.kb_search',
  // Web retrieval reads the public web, not our database: search and
  // fetch stay readable in sector scope so sector research skills can
  // discover companies from chat. Browser action stays Karbot-only
  // (sessions are task-scoped there; sector turns never drive pages).
  'web_search',
  'web_fetch',
  // Own-sector monitoring stays readable here; steering other sessions is
  // Karbot-only (send/steer need approver + confirmation anyway).
  'db.research_health',
  // Normal chats read everything in their sector: plan, progress,
  // sibling chats and subagent transcripts. Writes stay isolated.
  'db.get_sector_plan',
  'db.get_research_progress',
  'db.list_sector_sessions',
  'db.read_sector_thread',
  // Own-sector ops reads plus spawning under own threads; queue and run
  // controls stay Karbot-only.
  'ops.thread_health',
  'ops.cost',
  'ops.list_alerts',
  'ops.spawn_subagent',
])

export function sectorMcpClient(client: TurnRunnerMcpClient): TurnRunnerMcpClient {
  return {
    authorityId: client.authorityId,
    async listTools() {
      return (await client.listTools()).filter((tool) => SECTOR_TOOLS.has(tool.name))
    },
    async callTool(name, args, operationId) {
      if (!SECTOR_TOOLS.has(name)) return { content: `tool '${name}' is unavailable in sector chats`, isError: true }
      return client.callTool(name, args, operationId)
    },
  }
}

// Research-parent palette: SECTOR_TOOLS plus the plan writer. Only the
// research conversation's main agent ever sees this palette (normal chats,
// subagents and Karbot cannot write the plan). Stacked directly on the
// transport, never on productMcpClient: the plan writer is deliberately
// not a Karbot tool, so the Karbot wrapper would list-but-never-run it.
// The server grant plus invokeTool hold the boundary instead.
export const RESEARCH_TOOLS: ReadonlySet<string> = new Set([...SECTOR_TOOLS, 'db.update_sector_plan'])

export function researchMcpClient(client: TurnRunnerMcpClient): TurnRunnerMcpClient {
  return {
    authorityId: client.authorityId,
    async listTools() {
      return (await client.listTools()).filter((tool) => RESEARCH_TOOLS.has(tool.name))
    },
    async callTool(name, args, operationId) {
      if (!RESEARCH_TOOLS.has(name)) return { content: `tool '${name}' is unavailable to the research conversation`, isError: true }
      return client.callTool(name, args, operationId)
    },
  }
}

/** Effective tool palette for a turn: research parents get RESEARCH_TOOLS,
 * other sector chats get SECTOR_TOOLS, Karbot gets PRODUCT_TOOLS. A skill
 * grant narrows further. The grant travels to the server, where role
 * floors still apply per call. */
export function turnPalette(input: { sectorScoped?: boolean; researchParent?: boolean; toolAllow?: string[] }): string[] {
  const base = input.researchParent === true ? RESEARCH_TOOLS : input.sectorScoped === true ? SECTOR_TOOLS : PRODUCT_TOOLS
  if (input.toolAllow === undefined) return [...base]
  const allow = new Set(input.toolAllow)
  return [...base].filter((name) => allow.has(name))
}

/** Keep the original transport identity; effective names can only narrow. */
export function freezeOriginalPalette(client: TurnRunnerMcpClient, names: string[]): TurnRunnerMcpClient {
  const allowed = new Set(z.array(z.string().min(1).max(80)).max(128).parse(names))
  return { authorityId: client.authorityId, listTools: async () => (await client.listTools()).filter((tool) => allowed.has(tool.name)), callTool: (name, args, operationId) => allowed.has(name) ? client.callTool(name, args, operationId) : Promise.resolve({ content: 'This tool was not in the original execution contract.', isError: true }) }
}
