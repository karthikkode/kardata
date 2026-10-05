// MCP parity (Phase 5.1): every OpenAPI operation maps to an MCP tool or
// is owner-only with a reason. Run by `npm run registry:sync`; exits
// non-zero on any unmapped operation or unknown tool. Standalone:
// `node scripts/mcp-parity.mjs`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// operationId -> MCP tool, or `owner-only: <reason>`. Allowed reasons
// are protected approvals and raw binary downloads; anything else is a
// deviation the Phase 5 review package must justify (marked DEV).
const PARITY = {
  listSessions: 'db.list_sessions',
  createSession: 'db.create_session',
  getSession: 'db.get_session',
  deleteSession: 'db.delete_session',
  compactSession: 'owner-only: protected approval (context decision; working-context compaction)',
  renameSession: 'db.rename_session',
  setSessionModel: 'owner-only: DEV model selection (no MCP writer; owner preference per chat)',
  getProviders: 'owner-only: DEV provider catalog (no MCP reader; turns use assigned models)',
  createSessionArtifact: 'db.create_artifact',
  listSessionArtifacts: 'db.list_artifacts',
  listThreads: 'db.list_threads',
  getThread: 'db.get_thread',
  listMessages: 'db.get_thread',
  listSteeringReceipts: 'db.get_thread',
  streamThread: 'db.read_outbox',
  listSupervisionAlerts: 'ops.list_alerts',
  listRuns: 'ops.list_runs',
  getRun: 'ops.get_run',
  listSkills: 'owner-only: DEV UI picker data (no MCP list tool; skills invoke through the turn path)',
  inspectRun: 'ops.get_run',
  sendMessage: 'db.send_message',
  steerThread: 'db.steer_thread',
  pauseRun: 'ops.pause_run',
  resumeRun: 'ops.resume_run',
  cancelRun: 'ops.cancel_run',
  decideApproval: 'owner-only: protected approval',
  listSectors: 'db.list_sectors',
  createSector: 'db.create_sector',
  getSector: 'db.get_sector',
  startSector: 'db.start_sector_research',
  planSector: 'owner-only: protected approval (plan approve; planning entry is plan-lifecycle)',
  readSectorPlan: 'db.get_sector_plan',
  editSectorPlan: 'owner-only: protected approval (plan approve; owner plan edits)',
  approveSectorPlan: 'owner-only: protected approval (plan approve)',
  listSectorDocuments: 'db.list_sector_documents',
  attachSectorDocument: 'db.attach_sector_document',
  compactSectorContext: 'owner-only: protected approval (context decision; note consolidation)',
  getSectorContext: 'db.get_global_context',
  patchSectorContext: 'owner-only: protected approval (context decision; owner unit/note edits)',
  restartSector: 'ops.restart_sector_research',
  pauseSector: 'db.pause_sector_research',
  resumeSector: 'db.resume_sector_research',
  listCompanies: 'db.list_companies',
  listTenantArtifacts: 'db.list_tenant_artifacts',
  referenceArtifact: 'db.reference_artifact',
  getArtifactBody: 'owner-only: raw binary download',
  mcpRpc: 'owner-only: DEV the MCP transport itself (every tool is invoked through it)',
  ensureSectorResearchSession: 'db.list_sector_sessions',
  getGlobalContext: 'db.get_global_context',
  editGlobalContext: 'owner-only: protected approval (context decision; owner direct edits)',
  proposeGlobalContext: 'db.propose_global_context',
  previewContextProposal: 'owner-only: protected approval (context decision; approval-surface read)',
  decideContextProposal: 'owner-only: protected approval (context decision)',
  reviewResearchWork: 'owner-only: protected approval (approver work-review decision)',
  getResearchProgress: 'db.get_research_progress',
  getSectorEvaluation: 'ops.sector_evaluation',
  listSectorFiles: 'db.list_sector_files',
  setSectorFileVisibility: 'owner-only: DEV file curation (no MCP writer; visibility is owner-managed)',
  requestFileContext: 'db.propose_file_context',
  inspectThreadOperation: 'owner-only: DEV idempotency receipts (no MCP reader; transport introspection)',
  getLocalContext: 'db.get_local_context',
  editLocalContext: 'owner-only: protected approval (context decision; owner direct edits)',
  rebuildLocalContext: 'owner-only: protected approval (context decision; owner rebuilds)',
  compactLocalContext: 'owner-only: protected approval (context decision; owner compaction)',
  getSectorFileUnits: 'db.query_document',
  retryFileProcessing: 'owner-only: protected approval (paid retry acknowledgement)',
  getSectorFileBody: 'owner-only: raw binary download',
  listExecutionRecords: 'ops.recent_activity',
  getExecutionRecord: 'owner-only: raw binary download (stored record bodies; metadata via ops.recent_activity)',
}

function operations() {
  const doc = parseYaml(readFileSync(join(ROOT, 'backend', 'openapi', 'v1.yaml'), 'utf8'))
  const ops = []
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (op && typeof op === 'object' && op.operationId) ops.push({ id: op.operationId, route: `${method.toUpperCase()} ${path}` })
    }
  }
  return ops.sort((a, b) => a.id.localeCompare(b.id))
}

function toolNames() {
  const text = readFileSync(join(ROOT, 'backend', 'src', 'mcp', 'tools.ts'), 'utf8')
  const start = text.indexOf('export const TOOL_LAYER')
  const block = text.slice(start, text.indexOf('\n}', start))
  return new Set([...block.matchAll(/^  '([^']+)':/gm)].map((match) => match[1]))
}

export function writeParity() {
  const ops = operations()
  const tools = toolNames()
  const unmapped = ops.filter((op) => !(op.id in PARITY)).map((op) => op.id)
  if (unmapped.length > 0) throw new Error(`mcp-parity: unmapped operations: ${unmapped.join(', ')}`)
  const ids = new Set(ops.map((op) => op.id))
  const stale = Object.keys(PARITY).filter((id) => !ids.has(id))
  if (stale.length > 0) throw new Error(`mcp-parity: stale entries: ${stale.join(', ')}`)
  const unknown = Object.values(PARITY).filter((target) => !target.startsWith('owner-only:') && !tools.has(target))
  if (unknown.length > 0) throw new Error(`mcp-parity: unknown tools: ${[...new Set(unknown)].join(', ')}`)
  const rows = ops.map((op) => `| ${op.id} | ${op.route} | ${PARITY[op.id]} |`)
  const mapped = rows.filter((row) => !row.includes('owner-only:')).length
  const deviations = rows.filter((row) => row.includes('owner-only: DEV')).length
  const doc = `# MCP parity (Phase 5.1)\n\nGenerated by \`npm run registry:sync\` via \`scripts/mcp-parity.mjs\`. Do not edit by hand.\n\n${ops.length} operations: ${mapped} map to an MCP tool, ${ops.length - mapped} are owner-only (${deviations} DEV reasons outside the allowed list; justified in the Phase 5 review package).\n\n| operation | route | tool / reason |\n|---|---|---|\n${rows.join('\n')}\n`
  writeFileSync(join(ROOT, 'docs', 'mcp-parity.md'), doc)
  console.log(`mcp-parity: ${ops.length} operations, ${mapped} mapped, ${ops.length - mapped} owner-only (${deviations} DEV)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeParity()
