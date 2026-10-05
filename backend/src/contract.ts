// B0.2 contract harness. The parity table maps every live UI wire shape to
// its v1 counterpart. The mock era is over: no entry may point at a fixture,
// and the contract test fails when a UI shape is unlisted, a counterpart
// pointer is missing from the spec, or a new exported UI type appears
// without coverage.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

type ParityKind = 'counterpart' | 'deferred'

export interface ParityEntry {
  sourceFile: string
  mockType: string
  kind: ParityKind
  /** JSON pointer into backend/openapi/v1.yaml (counterparts only). */
  specPointer?: string
  /** Owning plan task (deferrals only). */
  ownerTask?: string
  note: string
}

export const PARITY: ParityEntry[] = [
  { sourceFile:'frontend/src/data/api/files.ts',mockType:'FileProcessingProgress',kind:'counterpart',specPointer:'#/components/schemas/FileProcessingProgress',note:'scoped file job lifecycle and paid retry risk' },
  { sourceFile:'frontend/src/data/api/files.ts',mockType:'FileUnitsPage',kind:'counterpart',specPointer:'#/components/schemas/FileUnitsPage',note:'bounded indexed sections with exact inclusive ordinal cursor' },
  { sourceFile: 'frontend/src/data/alerts.ts', mockType: 'SupervisionAlert', kind: 'counterpart', specPointer: '#/components/schemas/SupervisionAlert', note: 'scoped durable supervision notice with current-warning proof' },
  { sourceFile: 'frontend/src/data/alerts.ts', mockType: 'SupervisionAlertsPage', kind: 'counterpart', specPointer: '#/components/schemas/SupervisionAlertPage', note: 'exclusive descending sequence pages capped at100' },
  { sourceFile: 'frontend/src/data/api/execution-records.ts', mockType: 'ExecutionRecordMetadata', kind: 'counterpart', specPointer: '#/components/schemas/ExecutionRecordMetadata', note: 'approver-only scoped journal metadata without archive keys' },
  { sourceFile: 'frontend/src/data/api/execution-records.ts', mockType: 'ExecutionRecordPage', kind: 'counterpart', specPointer: '#/components/schemas/ExecutionRecordPage', note: 'chronological bounded execution inspection pages' },
  { sourceFile: 'frontend/src/data/api/execution-records.ts', mockType: 'ExecutionRecordBody', kind: 'counterpart', specPointer: '#/components/schemas/ExecutionRecordBody', note: 'verified archived normalized adapter JSON object' },
  { sourceFile: 'frontend/src/data/api/threads.ts', mockType: 'OperationReceipt', kind: 'counterpart', specPointer: '#/paths/~1v1~1threads~1{threadKey}~1operations~1{operationId}/get/responses/200/content/application~1json/schema/properties/data', note: 'scoped durable operation inspection' },
  { sourceFile: 'frontend/src/data/api/sessions.ts', mockType: 'Session', kind: 'counterpart', specPointer: '#/components/schemas/Session', note: 'session rows render titles; age stays a client-side format of createdAt/updatedAt' },
  { sourceFile: 'frontend/src/data/api/threads.ts', mockType: 'ThreadView', kind: 'counterpart', specPointer: '#/components/schemas/Thread', note: 'session thread plus one thread per subagent' },
  { sourceFile: 'frontend/src/data/api/live.ts', mockType: 'StreamFrame', kind: 'counterpart', specPointer: '#/components/schemas/StreamEvent', note: 'delta/message frames tail the visible thread (renamed from StreamEvent in the P2 api split)' },
  { sourceFile: 'frontend/src/data/api/artifacts.ts', mockType: 'ArtifactSummary', kind: 'counterpart', specPointer: '#/components/schemas/ArtifactSummary', note: 'file menu rows: id from artifactId, source from kind' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'ResearchState', kind: 'counterpart', specPointer: '#/components/schemas/ResearchState', note: 'sector/company state union' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'SectorResearch', kind: 'counterpart', specPointer: '#/components/schemas/SectorResearch', note: 'companiesFound is computed server-side' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'CompanyResearch', kind: 'counterpart', specPointer: '#/components/schemas/CompanyResearch', note: 'name renders from company, sectorName from sector' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'SectorDetail', kind: 'counterpart', specPointer: '#/components/schemas/SectorDetail', note: 'detail page: companies, activity, found count' },
  { sourceFile: 'frontend/src/data/api/runs.ts', mockType: 'RunSummary', kind: 'counterpart', specPointer: '#/components/schemas/Run', note: 'runs view rows with budget/context ratios' },
  { sourceFile: 'frontend/src/data/api/runs.ts', mockType: 'RunState', kind: 'counterpart', specPointer: '#/components/schemas/RunState', note: 'run lifecycle states' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatScope', kind: 'counterpart', specPointer: '#/components/parameters/ThreadKey', note: 'scope addressing is the thread key' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatText', kind: 'counterpart', specPointer: '#/components/schemas/ThreadMessage', note: 'text variant: role/text/failed/missedSteer' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatTool', kind: 'counterpart', specPointer: '#/components/schemas/ThreadMessage', note: 'tool variant: name/detail/state' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatMessage', kind: 'counterpart', specPointer: '#/components/schemas/ThreadMessage', note: 'the text|tool union' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatFile', kind: 'counterpart', specPointer: '#/components/schemas/ArtifactSummary', note: 'file menu rows render from artifacts' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'MessageSegment', kind: 'counterpart', specPointer: '#/components/schemas/ThreadMessage', note: 'presentational fold of text|tool rows; not a wire shape' },
  { sourceFile: 'frontend/src/components/chat/MessageBubble.tsx', mockType: 'ReasoningControl', kind: 'counterpart', specPointer: '#/components/schemas/ThreadMessage', note: 'presentational popover control for message reasoning; not a wire shape' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'Sections', kind: 'counterpart', specPointer: '#/components/schemas/ContextSections', note: 'global context four-section body' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'GlobalContext', kind: 'counterpart', specPointer: '#/components/schemas/GlobalContext', note: 'versioned shared context with pending changes' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'ContextChange', kind: 'counterpart', specPointer: '#/components/schemas/ContextChange', note: 'proposal states through the approval flow' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'ContextPreview', kind: 'counterpart', specPointer: '#/components/schemas/ContextPreview', note: 'proposal plus exact file units' },
  { sourceFile: 'frontend/src/data/api/files.ts', mockType: 'SectorFileBody', kind: 'counterpart', specPointer: '#/components/schemas/SectorFileBody', note: 'sector file preview and original download' },
  { sourceFile: 'frontend/src/data/api/files.ts', mockType: 'LibraryFile', kind: 'counterpart', specPointer: '#/components/schemas/LibraryFile', note: 'sector file rows with hidden/included flags' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'LocalContext', kind: 'counterpart', specPointer: '#/components/schemas/LocalContext', note: 'per-thread working memory' },
  { sourceFile: 'frontend/src/data/api/progress.ts', mockType: 'ResearchProgress', kind: 'counterpart', specPointer: '#/components/schemas/ResearchProgress', note: 'plan versions, work items, estimate' },
]

export function loadSpec(): unknown {
  const here = dirname(fileURLToPath(import.meta.url))
  const text = readFileSync(join(here, '..', 'openapi', 'v1.yaml'), 'utf8')
  return parseYaml(text)
}

function resolvePointer(spec: unknown, pointer: string): unknown {
  const parts = pointer.replace(/^#\//, '').split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = spec
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || !(part in current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** Returns human-readable parity violations; empty means the contract holds. */
export function checkParity(spec: unknown): string[] {
  const problems: string[] = []
  for (const entry of PARITY) {
    if (entry.kind === 'counterpart') {
      if (!entry.specPointer) {
        problems.push(`${entry.mockType}: counterpart without specPointer`)
      } else if (resolvePointer(spec, entry.specPointer) === undefined) {
        problems.push(`${entry.mockType}: pointer ${entry.specPointer} missing from spec`)
      }
    } else if (!entry.ownerTask) {
      problems.push(`${entry.mockType}: deferral without ownerTask`)
    }
  }
  return problems
}

/** Type names the table must cover: the live UI wire shapes. The api
 * modules also export client infra types (StagingConfig in api/client.ts,
 * CommandAccepted in api/commands.ts, stream intermediates) with no wire
 * shape; they stay out of this table by decision, while every
 * UI-rendered shape above is listed. */
export const EXPECTED_TYPES: Array<{ sourceFile: string; mockType: string }> = [
  { sourceFile: 'frontend/src/data/api/sessions.ts', mockType: 'Session' },
  { sourceFile: 'frontend/src/data/api/threads.ts', mockType: 'ThreadView' },
  { sourceFile: 'frontend/src/data/api/live.ts', mockType: 'StreamFrame' },
  { sourceFile: 'frontend/src/data/api/artifacts.ts', mockType: 'ArtifactSummary' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'ResearchState' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'SectorResearch' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'CompanyResearch' },
  { sourceFile: 'frontend/src/data/api/sectors.ts', mockType: 'SectorDetail' },
  { sourceFile: 'frontend/src/data/api/runs.ts', mockType: 'RunSummary' },
  { sourceFile: 'frontend/src/data/api/runs.ts', mockType: 'RunState' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatScope' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatText' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatTool' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatMessage' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'ChatFile' },
  { sourceFile: 'frontend/src/components/chat/messages.ts', mockType: 'MessageSegment' },
  { sourceFile: 'frontend/src/components/chat/MessageBubble.tsx', mockType: 'ReasoningControl' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'Sections' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'GlobalContext' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'ContextChange' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'ContextPreview' },
  { sourceFile: 'frontend/src/data/api/files.ts', mockType: 'LibraryFile' },
  { sourceFile: 'frontend/src/data/api/files.ts', mockType: 'SectorFileBody' },
  { sourceFile: 'frontend/src/data/api/context.ts', mockType: 'LocalContext' },
  { sourceFile: 'frontend/src/data/api/progress.ts', mockType: 'ResearchProgress' },
]
