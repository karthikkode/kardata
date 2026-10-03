import { describe, expect, it } from 'vitest'
import {
  alertKindLabel, companiesEmptyCopy, companyStageLabel, fileStatusLabel,
  planSectionLabel, researchNextStep, researchStateLabel, runStateLabel, statusSummary,
  threadStatusLabel, toolFamily, toolLabel,
} from '@/lib/labels'

describe('humanized labels (F12)', () => {
  it('labels every research state', () => {
    expect([
      'draft', 'planning', 'planned', 'approved', 'running',
      'paused', 'queued', 'failed', 'complete',
    ].map(researchStateLabel)).toEqual([
      'Draft', 'Planning', 'Planned', 'Approved', 'In progress',
      'Paused', 'Queued', 'Failed', 'Complete',
    ])
    expect(researchStateLabel('mystery_state')).toBe('Mystery state')
  })

  it('labels company stages without raw filter names', () => {
    expect(companyStageLabel('Filter')).toBe('Screening')
    expect(companyStageLabel('Deep research')).toBe('Deep research')
    expect(companyStageLabel('Problem found')).toBe('Problem found')
    expect(companyStageLabel('Final validation')).toBe('Final validation')
  })

  it('labels plan sections old and new, case-insensitively', () => {
    expect(planSectionLabel('scope')).toBe('Scope')
    expect(planSectionLabel('direction shards')).toBe('Search directions')
    expect(planSectionLabel('Search Directions')).toBe('Search directions')
    expect(planSectionLabel('query shapes')).toBe('Search queries')
    expect(planSectionLabel('budgets')).toBe('Budget and limits')
    expect(planSectionLabel('Budget and Limits')).toBe('Budget and limits')
    expect(planSectionLabel('risks')).toBe('Risks')
    expect(planSectionLabel('open questions')).toBe('Open questions')
    expect(planSectionLabel('Goal')).toBe('Goal')
    expect(planSectionLabel('Steps')).toBe('Steps')
    expect(planSectionLabel('custom_key')).toBe('Custom key')
  })

  it('labels tools in plain words, never raw ids', () => {
    expect(toolLabel('db.kb_search')).toBe('Searched knowledge base')
    expect(toolLabel('db.get_sector')).toBe('Read sector')
    expect(toolLabel('web_search')).toBe('Searched the web')
    expect(toolLabel('db.some_new_tool')).toBe('Some new tool')
    expect(toolLabel('custom.tool_name')).toBe('Tool name')
  })

  it('groups tools by family for activity icons', () => {
    expect(toolFamily('db.kb_search')).toBe('search')
    expect(toolFamily('web_search')).toBe('search')
    expect(toolFamily('browser_navigate')).toBe('web')
    expect(toolFamily('web_fetch')).toBe('web')
    expect(toolFamily('db.query_document')).toBe('document')
    expect(toolFamily('db.create_artifact')).toBe('document')
    expect(toolFamily('db.get_sector')).toBe('default')
  })

  it('labels run states, alert kinds, and file statuses', () => {
    expect(runStateLabel('RUNNING')).toBe('Running')
    expect(runStateLabel('CANCELLING')).toBe('Cancelling')
    expect(runStateLabel('ERROR')).toBe('Failed')
    expect(alertKindLabel('missing-heartbeat')).toBe('Heartbeat lost')
    expect(alertKindLabel('stalled-progress')).toBe('Progress stalled')
    expect(fileStatusLabel('indexed')).toBe('Indexed')
    expect(fileStatusLabel('uncertain')).toBe('Needs review')
    expect(fileStatusLabel('needs-ocr')).toBe('Needs OCR')
    expect(fileStatusLabel('needs_ocr')).toBe('Needs OCR')
    expect(fileStatusLabel('weird_status')).toBe('Weird status')
    expect(threadStatusLabel('RUNNING')).toBe('Running')
    expect(threadStatusLabel('QUEUED')).toBe('Queued')
    expect(threadStatusLabel('STOPPED')).toBe('Stopped')
    expect(threadStatusLabel('PAUSED')).toBe('Paused')
  })

  it('summarizes every research state in one sentence', () => {
    for (const state of ['draft', 'planning', 'planned', 'approved', 'running', 'paused', 'queued', 'failed', 'complete']) {
      const summary = statusSummary(state)
      expect(summary.length, state).toBeGreaterThan(10)
      expect(summary.endsWith('.'), state).toBe(true)
    }
    expect(statusSummary('planned')).toContain('review')
    expect(statusSummary('mystery')).toBe('Research status is not available.')
  })

  it('explains empty companies per state', () => {
    expect(companiesEmptyCopy('draft').title).toBe('Research has not started')
    expect(companiesEmptyCopy('planned').body).toContain('Approve the plan')
    expect(companiesEmptyCopy('running').body).toContain('as research discovers them')
    expect(companiesEmptyCopy('failed').title).toBe('Research stopped')
    expect(companiesEmptyCopy('complete').title).toBe('No companies found')
  })

  it('offers a next step only where an action exists', () => {
    expect(researchNextStep('planned')).toEqual({ text: 'A plan is waiting for your approval.', action: 'review-plan', label: 'Review plan' })
    expect(researchNextStep('approved')).toEqual({ text: 'Start research from the workspace.', action: 'open-workspace', label: 'Open workspace' })
    expect(researchNextStep('failed')).toEqual({ text: 'Find out what went wrong.', action: 'open-workspace', label: 'Review in workspace' })
    for (const state of ['draft', 'planning', 'running', 'paused', 'queued', 'complete', 'mystery']) {
      expect(researchNextStep(state), state).toBeNull()
    }
  })
})
