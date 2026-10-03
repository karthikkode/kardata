// Humanized labels (F12). Raw internal keys never reach the UI: research
// states, company stages, plan section keys, tool names, run states, alert
// kinds, and file statuses all map here. Unknown keys fall back to
// sentence-cased humanizeKey, never raw.
import { humanizeKey } from './format'

export const researchStateLabels: Record<string, string> = {
  draft: 'Draft',
  planning: 'Planning',
  planned: 'Planned',
  approved: 'Approved',
  running: 'In progress',
  paused: 'Paused',
  queued: 'Queued',
  failed: 'Failed',
  complete: 'Complete',
}

export function researchStateLabel(state: string): string {
  return researchStateLabels[state] ?? humanizeKey(state)
}

export const companyStageLabels: Record<string, string> = {
  Filter: 'Screening',
  'Deep research': 'Deep research',
  'Problem found': 'Problem found',
  'Final validation': 'Final validation',
}

export function companyStageLabel(stage: string): string {
  return companyStageLabels[stage] ?? humanizeKey(stage)
}

export const planSectionLabels: Record<string, string> = {
  scope: 'Scope',
  goal: 'Goal',
  'direction shards': 'Search directions',
  'search directions': 'Search directions',
  'query shapes': 'Search queries',
  steps: 'Steps',
  budgets: 'Budget and limits',
  'budget and limits': 'Budget and limits',
  risks: 'Risks',
  'open questions': 'Open questions',
}

export function planSectionLabel(key: string): string {
  return planSectionLabels[key.trim().toLowerCase()] ?? humanizeKey(key)
}

const toolNameLabels: Record<string, string> = {
  'db.kb_search': 'Searched knowledge base',
  'db.list_sectors': 'Listed sectors',
  'db.get_sector': 'Read sector',
  'db.create_sector': 'Created sector',
  'db.list_companies': 'Listed companies',
  'db.list_sector_companies': 'Listed sector companies',
  'db.sector_activity': 'Read sector activity',
  'db.get_session': 'Read session',
  'db.list_sessions': 'Listed sessions',
  'db.create_session': 'Created session',
  'db.rename_session': 'Renamed session',
  'db.get_thread': 'Read conversation',
  'db.list_threads': 'Listed conversations',
  'db.append_event': 'Recorded event',
  'db.mark_company_found': 'Recorded company',
  'db.set_company_stage': 'Updated company stage',
  'db.set_company_state': 'Updated company state',
  'db.delegate_subagent': 'Started subagent',
  'db.send_message': 'Sent message',
  'db.steer_thread': 'Steered conversation',
  'db.pause_run': 'Paused run',
  'db.resume_run': 'Resumed run',
  'db.cancel_run': 'Cancelled run',
  'db.get_global_context': 'Read shared context',
  'db.get_local_context': 'Read working context',
  'db.propose_global_context': 'Proposed context update',
  'db.commit_child_context': 'Saved finding',
  'db.list_sector_files': 'Listed files',
  'db.propose_file_context': 'Proposed file context',
  'db.attach_sector_document': 'Attached document',
  'db.list_sector_documents': 'Listed documents',
  'db.read_sector_document': 'Read document',
  'db.query_document': 'Searched document',
  'db.create_artifact': 'Created file',
  'db.list_artifacts': 'Listed files',
  'db.reference_artifact': 'Attached file',
  web_search: 'Searched the web',
  web_fetch: 'Fetched page',
  browser_navigate: 'Opened page',
  browser_snapshot: 'Read page',
  browser_act: 'Used page',
  browser_screenshot: 'Took screenshot',
  browser_close: 'Closed browser',
  'plan.create': 'Created plan',
  'plan.update': 'Updated plan',
  'task.checkpoint': 'Saved checkpoint',
  'artifact.read': 'Read file',
}

export function toolLabel(name: string): string {
  const mapped = toolNameLabels[name]
  if (mapped) return mapped
  const action = (name.split('.').at(-1) ?? name).replaceAll('_', ' ')
  return action.charAt(0).toUpperCase() + action.slice(1)
}

/** Tool family for the activity icon: search, web, document, or default. */
export function toolFamily(name: string): 'search' | 'web' | 'document' | 'default' {
  if (name === 'web_search' || name === 'db.kb_search') return 'search'
  if (name.startsWith('browser_') || name === 'web_fetch') return 'web'
  if (
    name === 'db.attach_sector_document' ||
    name === 'db.list_sector_documents' ||
    name === 'db.read_sector_document' ||
    name === 'db.query_document' ||
    name === 'db.create_artifact' ||
    name === 'db.list_artifacts' ||
    name === 'artifact.read'
  ) {
    return 'document'
  }
  return 'default'
}

export const runStateLabels: Record<string, string> = {
  IDLE: 'Idle',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  SUSPENDED: 'Suspended',
  CANCELLING: 'Cancelling',
  FINISHED: 'Finished',
  ERROR: 'Failed',
}

export function runStateLabel(state: string): string {
  return runStateLabels[state] ?? humanizeKey(state)
}

export const threadStatusLabels: Record<string, string> = {
  RUNNING: 'Running',
  QUEUED: 'Queued',
  STOPPED: 'Stopped',
}

export function threadStatusLabel(status: string): string {
  return threadStatusLabels[status] ?? humanizeKey(status)
}

export const alertKindLabels: Record<string, string> = {
  'closed-owner': 'Run closed',
  'missing-heartbeat': 'Heartbeat lost',
  'stalled-progress': 'Progress stalled',
  'queue-starvation': 'Queue starved',
  'owner-unavailable': 'Owner unavailable',
}

export function alertKindLabel(kind: string): string {
  return alertKindLabels[kind] ?? humanizeKey(kind)
}

export const fileStatusLabels: Record<string, string> = {
  indexed: 'Indexed',
  processing: 'Processing',
  queued: 'Queued',
  paused: 'Paused',
  failed: 'Failed',
  uncertain: 'Needs review',
  complete: 'Complete',
  'needs-ocr': 'Needs OCR',
  needs_ocr: 'Needs OCR',
}

export function fileStatusLabel(status: string): string {
  return fileStatusLabels[status] ?? humanizeKey(status)
}

const statusSummaries: Record<string, string> = {
  draft: 'This sector is a draft. Attach context and create a plan when ready.',
  planning: 'Your research agent is drafting the plan.',
  planned: 'The research plan is ready for review.',
  approved: 'The plan is approved. Start research when ready.',
  running: 'Research is running. Companies appear as the agent finds them.',
  paused: 'Research is paused. Resume to continue where it stopped.',
  queued: 'Research is queued and starts automatically.',
  failed: 'Research stopped on an error. Review it and restart.',
  complete: 'Research finished. Review the companies it found.',
}

/** One-sentence research status summary per sector state. */
export function statusSummary(state: string): string {
  return statusSummaries[state] ?? 'Research status is not available.'
}

const companiesEmpty: Record<string, { title: string; body: string }> = {
  draft: { title: 'Research has not started', body: 'Create and approve a plan to start discovering companies.' },
  planning: { title: 'Research has not started', body: 'Companies appear here once the plan is approved and research starts.' },
  planned: { title: 'Research has not started', body: 'Approve the plan to start discovering companies.' },
  approved: { title: 'Research has not started', body: 'Start research to discover companies.' },
  queued: { title: 'Research is queued', body: 'Companies appear here once the queued research starts.' },
  running: { title: 'No companies yet', body: 'Companies appear here as research discovers them.' },
  paused: { title: 'No companies yet', body: 'Resume research to keep discovering companies.' },
  failed: { title: 'Research stopped', body: 'Restart research to discover companies.' },
  complete: { title: 'No companies found', body: 'Research finished without discovering companies.' },
}

/** First-run companies empty copy per sector state. */
export function companiesEmptyCopy(state: string): { title: string; body: string } {
  return companiesEmpty[state] ?? { title: 'No companies yet', body: 'Companies appear here as research discovers them.' }
}

export interface ResearchNextStep {
  text: string
  action: 'review-plan' | 'open-workspace'
  label: string
}

const nextSteps: Record<string, ResearchNextStep> = {
  planned: { text: 'A plan is waiting for your approval.', action: 'review-plan', label: 'Review plan' },
  approved: { text: 'Start research from the workspace.', action: 'open-workspace', label: 'Open workspace' },
  failed: { text: 'Find out what went wrong.', action: 'open-workspace', label: 'Review in workspace' },
}

/** Next-step hint for the landing status panel; null when the summary suffices. */
export function researchNextStep(state: string): ResearchNextStep | null {
  return nextSteps[state] ?? null
}
