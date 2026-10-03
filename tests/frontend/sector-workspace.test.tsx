import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SectorLanding } from '@/components/SectorLanding'
import { GlobalContextPanel, LocalContextEditor, PlanProgress, ResourceNotice, WorkspaceFiles } from '@/components/workspace-parts'
import type { SectorDetail } from '@/data/staging-api'
import type { GlobalContext, ResearchProgress } from '@/data/workspace-api'
import type { Resource } from '@/data/useWorkspace'

const sector: SectorDetail = { id: 'test-sector', name: 'TEST sector', topic: 'Topic', state: 'draft', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, researchSessionId: null, createdAt: '2026-09-30', updatedAt: '2026-09-30' }
const progress: Resource<ResearchProgress> = { status: 'ready', refresh: vi.fn(), data: { sectorId: sector.id, state: 'draft', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null } }
const global: GlobalContext = { sectorId: sector.id, version: 1, researchSessionId: 'research', sections: { scope: 'Scope text', decisions: 'Owner decision', findings: '', questions: '' }, markdown: '## Scope\nScope text', changes: [] }
it('shows recorded research time without treating it as completion', () => {
  render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, budgetUsedMs: 90_000 } }} />)
  expect(screen.getByText('1m active time across runs')).toBeInTheDocument()
  expect(screen.getByText('Not estimated yet')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})
describe('progress panel v2', () => {
  const mixedItems = [
    { id: 'work-a', title: 'Done company', kind: 'company' as const, state: 'complete' as const, attempts: 1, childId: null, evidence: [] },
    { id: 'work-b', title: 'Running company', kind: 'company' as const, state: 'running' as const, attempts: 1, childId: null, evidence: [] },
    { id: 'work-c', title: 'Blocked intake', kind: 'intake' as const, state: 'blocked' as const, attempts: 2, childId: null, evidence: [], detail: 'Waiting on owner' },
    { id: 'work-d', title: 'Skipped company', kind: 'company' as const, state: 'excluded' as const, attempts: 1, childId: null, evidence: [] },
  ]
  it('shows percent caption and counters for running research', () => {
    render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, state: 'running', estimatedPercent: 62, items: mixedItems } }} />)
    expect(screen.getByText('62% estimated')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62')
    for (const label of ['Completed', 'Running', 'Needs attention', 'Excluded']) expect(screen.getByText(label)).toBeInTheDocument()
  })
  it('expands work-item detail on request', async () => {
    const user = userEvent.setup()
    render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, state: 'running', items: mixedItems } }} />)
    await user.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText('Waiting on owner')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Hide details' }))
    expect(screen.getByRole('button', { name: 'Show details' })).toHaveAttribute('aria-expanded', 'false')
  })
  it('restores the ledger through Clear search', async () => {
    const user = userEvent.setup()
    render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, state: 'running', items: mixedItems } }} />)
    await user.type(screen.getByRole('textbox', { name: 'Search work items' }), 'Nothing matches this')
    expect(screen.getByText('No matching work items.')).toBeInTheDocument()
    await user.click(screen.getByText('Clear search'))
    expect(screen.getByText('Done company')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Search work items' })).toHaveValue('')
  })
  it('keeps the review action to intake items with a receipt', () => {
    const receipt = { id: 'r-1', key: 'TEST key', state: 'blocked' as const, attempts: 1, version: 1, reason: 'R', sourceUrl: null, sourceTitle: null, updatedAt: '2026-09-30' }
    render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, state: 'running', items: mixedItems } }} review={{ open: false, onOpenChange: () => {}, loading: false, action: vi.fn(), receipts: { 'work-a': receipt }, busy: false, stale: false, onRetry: () => {}, onExclude: () => {}, onReload: () => {}, policyNote: null, paused: false, draft: '', onDraft: () => {} }} />)
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })
  it('opens sources in a new tab', () => {
    render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, state: 'running', items: [{ id: 'work-s', title: 'Sourced', kind: 'company' as const, state: 'complete' as const, attempts: 1, childId: null, evidence: [], sourceUrl: 'https://source.example.test/' }] } }} />)
    const link = screen.getByRole('link', { name: 'Open source' })
    expect(link).toHaveAttribute('href', 'https://source.example.test/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
it.each([['complete', 'Finished'], ['failed', 'Stopped']] as const)('does not present an empty %s ledger as future work', (state, caption) => {
  render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, state } }} />)
  expect(screen.getByText('No work ledger for this run')).toBeInTheDocument()
  expect(screen.getByText('No work-item ledger was recorded for this run. Saved companies and conversations remain available.')).toBeInTheDocument()
  expect(screen.getByText(caption)).toBeInTheDocument()
  if (state === 'failed') expect(screen.getByText(caption)).toHaveClass('text-danger')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByText('Research has not recorded any work yet.')).not.toBeInTheDocument()
})
describe('sector landing', () => {
  function renderLanding(overrides: Partial<ComponentProps<typeof SectorLanding>> = {}) {
    const props = {
      sector,
      status: 'ready' as const,
      config: null,
      progress,
      progressOpen: false,
      onProgressOpenChange: vi.fn(),
      onOpen: vi.fn(),
      onReviewPlan: vi.fn(),
      onBack: vi.fn(),
      onRetry: vi.fn(),
      ...overrides,
    }
    return { ...render(<SectorLanding {...props} />), props }
  }
  it.each([
    ['draft', 'This sector is a draft. Attach context and create a plan when ready.', 'Not estimated yet', 'Research has not started', 1],
    ['planning', 'Your research agent is drafting the plan.', 'Not estimated yet', 'Research has not started', 1],
    ['planned', 'The research plan is ready for review.', 'Not estimated yet', 'Research has not started', 1],
    ['approved', 'The plan is approved. Start research when ready.', 'Not estimated yet', 'Research has not started', 1],
    ['queued', 'Research is queued and starts automatically.', 'Not estimated yet', 'Research is queued', 1],
    ['running', 'Research is running. Companies appear as the agent finds them.', 'Not estimated yet', 'No companies yet', 1],
    ['paused', 'Research is paused. Resume to continue where it stopped.', 'Not estimated yet', 'No companies yet', 1],
    ['failed', 'Research stopped on an error. Review it and restart.', 'Stopped', 'Research stopped', 1],
    ['complete', 'Research finished. Review the companies it found.', 'Finished', 'No companies found', 1],
  ] as const)('summarizes %s with the honest progress and companies state', (state, summary, progressCopy, companiesTitle, summaryCount) => {
    renderLanding({ sector: { ...sector, state } })
    expect(screen.getAllByText(summary)).toHaveLength(summaryCount)
    expect(screen.getByText(progressCopy)).toBeInTheDocument()
    expect(screen.getByText(companiesTitle)).toBeInTheDocument()
    expect(screen.getByText('Companies found')).toBeInTheDocument()
    expect(screen.getByText('Last activity')).toBeInTheDocument()
    expect(screen.queryByText('Active time')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search companies' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status: All' })).toBeInTheDocument()
  })
  it('shows the estimate with a progress bar when known', () => {
    renderLanding({ sector: { ...sector, state: 'running' }, progress: { ...progress, data: { ...progress.data!, state: 'running', estimatedPercent: 62 } } })
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Estimated progress' })).toHaveAttribute('aria-valuenow', '62')
  })
  it.each([['complete', 'Finished'], ['failed', 'Stopped']] as const)('prefers the terminal %s caption over a stale estimate', (state, caption) => {
    renderLanding({ sector: { ...sector, state }, progress: { ...progress, data: { ...progress.data!, state, estimatedPercent: 62 } } })
    expect(screen.getByText(caption)).toBeInTheDocument()
    expect(screen.queryByText('62%')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: 'Estimated progress' })).not.toBeInTheDocument()
  })
  it('shows active time only when recorded', () => {
    renderLanding({ progress: { ...progress, data: { ...progress.data!, budgetUsedMs: 7_380_000 } } })
    expect(screen.getByText('Active time')).toBeInTheDocument()
    expect(screen.getByText('2h 3m')).toBeInTheDocument()
  })
  it('retries an unavailable progress tile', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    renderLanding({ progress: { status: 'error', refresh } })
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry progress' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
  it.each([
    ['planned', 'Review plan', 'onReviewPlan'],
    ['approved', 'Open workspace', 'onOpen'],
    ['failed', 'Review in workspace', 'onOpen'],
  ] as const)('routes the %s next step through %s', async (state, label, handler) => {
    const user = userEvent.setup()
    const { props } = renderLanding({ sector: { ...sector, state } })
    await user.click(screen.getByRole('button', { name: label }))
    expect(props[handler]).toHaveBeenCalledOnce()
  })
  it('shows no next step while research runs', () => {
    renderLanding({ sector: { ...sector, state: 'running' } })
    expect(screen.queryByRole('button', { name: 'Review plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review in workspace' })).not.toBeInTheDocument()
  })
  it('opens the controlled progress dialog with the plan condensed', async () => {
    const user = userEvent.setup()
    const onProgressOpenChange = vi.fn()
    const onOpen = vi.fn()
    renderLanding({
      sector: { ...sector, state: 'planned' },
      progress: { ...progress, data: { ...progress.data!, plan: { latest: { version: 2, markdown: '## Goal\nFind real companies.', at: '2026-09-30T10:00:00Z' }, versions: [], approvals: [], approvedVersion: null } } },
      progressOpen: true,
      onProgressOpenChange,
      onOpen,
    })
    const dialog = screen.getByRole('dialog', { name: 'Research progress' })
    expect(within(dialog).getByText('v2')).toBeInTheDocument()
    expect(screen.queryByText('Find real companies.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show plan details' }))
    expect(screen.getByText('Find real companies.')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Open workspace' }))
    expect(onOpen).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Close Research progress' }))
    expect(onProgressOpenChange).toHaveBeenCalledWith(false)
  })
  it('offers the way back when the sector is gone', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderLanding({ sector: undefined, onBack })
    expect(screen.queryByText('Sector not found')).not.toBeInTheDocument()
    expect(screen.getByText('This sector may have been removed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to researches' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
  it.each(['loading', 'error', 'denied', 'offline'] as const)('renders sector %s through the shared notice', (status) => {
    renderLanding({ status })
    if (status === 'loading') expect(screen.getByRole('status', { name: 'Sector is loading' })).toBeInTheDocument()
    else expect(screen.getByRole('alert')).toBeInTheDocument()
  })
  it.each(['error', 'denied', 'offline'] as const)('leaves the %s title to the page header', (status) => {
    renderLanding({ status })
    expect(screen.queryByText('Sector did not load.')).not.toBeInTheDocument()
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument()
    expect(screen.queryByText('You are offline')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
  it('writes the header meta line from real dates', async () => {
    const { sectorMetaLine } = await import('@/components/SectorLanding')
    expect(sectorMetaLine(sector)).toMatch(/^Created \d{1,2} \w{3} 2026 · Updated (.+ ago|Just now)$/)
  })
})
describe('workspace state and resource interactions', () => {
  it('keeps thousand-item progress reachable through search and bounded windows with source links', async () => {
    const user = userEvent.setup()
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: `work-${i}`, title: `TEST company ${i}`, kind: 'company' as const, state: 'complete' as const, attempts: 1, childId: null, evidence: [], detail: 'Discovered from source', sourceUrl: `https://company-${i}.example.test/` }))
    render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, items, completed: 1000, total: 1000 } }} />)
    expect(screen.getByText('Showing 50 of 1,000 work items')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('Showing 100 of 1,000 work items')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search work items' }), 'TEST company 999')
    expect(screen.getByText('Showing 1 of 1 work items')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute('href', 'https://company-999.example.test/')
    await user.clear(screen.getByRole('textbox', { name: 'Search work items' }))
    await user.type(screen.getByRole('textbox', { name: 'Search work items' }), 'No matching company')
    expect(screen.getByText('No matching work items.')).toBeInTheDocument()
  })
  it.each(['loading','error','denied','offline'] as const)('shows %s as its own state with a retry where possible', (status) => {
    render(<ResourceNotice resource={{ status, refresh: vi.fn() }} label="Files" />)
    if (status === 'loading') expect(screen.getByRole('status', { name: 'Files is loading' })).toBeInTheDocument()
    else { expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled() }
  })
  it('retains context edits after a failed save and freezes the reviewed base version', async () => {
    const user = userEvent.setup(), onSave = vi.fn(async () => false)
    const props = { resource: { status: 'ready' as const, data: global, refresh: vi.fn() }, preview: { status: 'loading' as const, refresh: vi.fn() }, busy: false, onReview: vi.fn(), onSave, onDecision: vi.fn(async () => true) }
    const { rerender } = render(<GlobalContextPanel {...props} />)
    await user.click(screen.getByRole('button', { name: 'Edit global context' }))
    await user.type(screen.getByRole('textbox', { name: 'Decisions' }), ' and a new decision')
    rerender(<GlobalContextPanel {...props} resource={{ ...props.resource, data: { ...global, version: 2 } }} error="Global context changed. Review the latest version." />)
    await user.click(screen.getByRole('button', { name: 'Save context' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ decisions: 'Owner decision and a new decision' }), 1)
    expect(screen.getByRole('textbox', { name: 'Decisions' })).toHaveValue('Owner decision and a new decision')
    expect(screen.getByRole('dialog', { name: 'Edit global context' })).toBeInTheDocument()
  })
  it('distinguishes hidden files, search empties and failed extraction', async () => {
    const user = userEvent.setup(), onHide = vi.fn()
    render(<WorkspaceFiles resource={{ status: 'ready', refresh: vi.fn(), data: [
      { id: 'visible', filename: 'TEST visible.md', status: 'indexed', source: 'Uploaded', hash: 'hash', hidden: false, included: false, kind: 'document' },
      { id: 'hidden', filename: 'TEST hidden.md', status: 'indexed', source: 'Uploaded', hash: 'hash2', hidden: true, included: false, kind: 'document' },
      { id: 'ocr', filename: 'TEST scan.pdf', status: 'needs-ocr', source: 'Uploaded', hash: 'hash3', hidden: false, included: false, kind: 'document' },
    ] }} busy={false} onUpload={vi.fn()} onHide={onHide} onInclude={vi.fn()} />)
    expect(screen.queryByText('TEST hidden.md')).not.toBeInTheDocument()
    expect(screen.getByText('Needs OCR')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show hidden files' }))
    await user.click(screen.getByRole('button', { name: 'Reveal TEST hidden.md to agents' }))
    expect(onHide).toHaveBeenCalledWith('hidden', false)
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'no-match')
    expect(screen.getByText('No matching files.')).toBeInTheDocument()
  })
  it('keeps local edits when background compaction updates the context', async () => {
    const user = userEvent.setup(), onSave = vi.fn()
    const resource = { status: 'ready' as const, refresh: vi.fn(), data: { threadKey: 'child', notes: 'Keep evidence', summary: '', coveredSeq: 0, version: 1 } }
    const { rerender } = render(<LocalContextEditor resource={resource} busy={false} onSave={onSave} onCompact={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Local notes' }), ' and broaden')
    rerender(<LocalContextEditor resource={{ ...resource, data: { ...resource.data, version: 2, summary: 'New summary' } }} busy={false} onSave={onSave} onCompact={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Save notes' }))
    expect(onSave).toHaveBeenCalledWith('Keep evidence and broaden', 1)
  })
})


it('shows pending operation recovery independently of compaction without exposing arguments', async () => {
  const user = userEvent.setup()
  const identity = 'op:'.concat('a'.repeat(64))
  render(<LocalContextEditor resource={{ status: 'ready', refresh: vi.fn(), data: { threadKey: 'TEST child', notes: '', summary: '', coveredSeq: 0, version: 1, pendingOperations: [{ operationId: identity, callId: 'TEST call', toolName: 'db.create_session', reason: 'The reply was lost.' }] } }} busy={false} onSave={vi.fn()} onCompact={vi.fn()} />)
  expect(screen.getByRole('region', { name: 'Pending operation recovery' })).toBeInTheDocument()
  expect(screen.getByText('An operation needs review')).toBeVisible()
  expect(screen.getByText('DB create session')).toBeVisible()
  expect(screen.getByText(identity)).not.toBeVisible()
  await user.click(screen.getByText('Operation identity'))
  expect(screen.getByText(identity)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Compact context' })).toBeEnabled()
})

it.each(['confirmed', 'unresolved'] as const)('inspects an original operation with an honest %s result', async (state) => {
  const user = userEvent.setup()
  const onInspect = vi.fn()
  const operationId = 'op:TEST exact identity'
  render(<LocalContextEditor resource={{ status: 'ready', refresh: vi.fn(), data: { threadKey: 'TEST thread', notes: 'TEST draft notes', summary: '', coveredSeq: 0, version: 1, pendingOperations: [{ operationId, callId: 'TEST call', toolName: 'db.create_session', reason: 'TEST reply uncertain' }] } }} busy={false} onSave={vi.fn()} onCompact={vi.fn()} onInspectOperation={onInspect} inspection={{ status: 'ready', refresh: vi.fn(), data: { operationId, state, reason: 'TEST exact receipt explanation' } }} />)
  await user.click(screen.getByRole('button', { name: 'Inspect receipt' }))
  expect(onInspect).toHaveBeenCalledWith(operationId)
  expect(screen.getByText(state === 'confirmed' ? 'Result confirmed' : 'Effect unresolved')).toBeVisible()
  expect(screen.getByText('TEST exact receipt explanation')).toBeVisible()
  expect(screen.getByLabelText('Local notes')).toHaveValue('TEST draft notes')
  expect(screen.queryByRole('button', { name: /mark.*successful|release.*claim/i })).not.toBeInTheDocument()
})

it('requires source preview before approving file-derived context and renders bounded exact units', async () => {
  const user = userEvent.setup(), onDecision = vi.fn(async () => true)
  const ref = { fileId: 'TEST source file', filename: 'TEST exact source.md', hash: 'a'.repeat(64), ords: Array.from({ length: 100 }, (_, i) => i) }
  const change = { id: 'TEST derived proposal', baseVersion: 1, sections: { ...global.sections, findings: 'TEST file-derived finding' }, sourceThread: 'research', author: 'research', state: 'pending' as const, version: null, at: '2026-10-01', fileRef: null, sourceRefs: [ref] }
  const props = { resource: { status: 'ready' as const, refresh: vi.fn(), data: { ...global, changes: [change] } }, preview: { status: 'loading' as const, refresh: vi.fn() }, busy: false, onReview: vi.fn(), onSave: vi.fn(async () => true), onDecision }
  const { rerender } = render(<GlobalContextPanel {...props} />)
  await user.click(screen.getByRole('button', { name: 'Review File-derived context update' }))
  expect(screen.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  const units = ref.ords.map((ord) => ({ ord, text: `TEST exact source unit ${ord}`, uncertain: false }))
  rerender(<GlobalContextPanel {...props} preview={{ status: 'ready', refresh: vi.fn(), data: { change, units: [], sources: [{ ref, units }] } }} />)
  expect(screen.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled()
  expect(screen.queryByText('TEST exact source unit 99')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Show more source units' }))
  expect(screen.getByText('TEST exact source unit 99')).toBeVisible()
  await user.click(screen.getByText('TEST exact source.md · 100 units'))
  expect(screen.getByText(ref.hash)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Approve', exact: true }))
  expect(onDecision).toHaveBeenCalledWith(change.id, true)
})

it('preserves a safe-rebuild draft on failure and requires explicit independent-context confirmation', async () => {
  const user = userEvent.setup(), onRebuild = vi.fn(async () => false)
  const data = { threadKey: 'TEST context', notes: 'TEST notes stay', summary: 'TEST stored historical summary', task: 'TEST original objective', coveredSeq: 4, version: 2, contextBlocked: 'TEST hidden source blocks new assembly', sourceRefs: [{ fileId: 'TEST file', hash: 'b'.repeat(64), filename: 'TEST hidden source.md', ords: [0] }] }
  const props = { resource: { status: 'ready' as const, refresh: vi.fn(), data }, busy: false, onSave: vi.fn(), onCompact: vi.fn(), onRebuild }
  const { rerender } = render(<LocalContextEditor {...props} />)
  expect(screen.getByText(data.summary)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Compact context' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Review safe rebuild' }))
  expect(screen.getByRole('button', { name: 'Confirm safe rebuild' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Independent replacement' }), 'TEST reviewed objectives, completed work and open questions')
  expect(screen.getByRole('region', { name: 'Replacement preview' })).toBeVisible()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Confirm safe rebuild' }))
  expect(onRebuild).toHaveBeenCalledWith('TEST reviewed objectives, completed work and open questions', 2)
  expect(screen.getByRole('textbox', { name: 'Independent replacement' })).toHaveValue('TEST reviewed objectives, completed work and open questions')
  rerender(<LocalContextEditor {...props} resource={{ ...props.resource, data: { ...data, version: 3 } }} error="Context changed" />)
  expect(screen.getByRole('button', { name: 'Confirm safe rebuild' })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'Independent replacement' })).toHaveValue('TEST reviewed objectives, completed work and open questions')
})

describe('global context panel v2', () => {
  function renderPanel(data: GlobalContext = global, onReview = vi.fn()) {
    const onSave = vi.fn(async () => true), onDecision = vi.fn(async () => true)
    const view = render(<GlobalContextPanel resource={{ status: 'ready', refresh: vi.fn(), data }} preview={{ status: 'loading', refresh: vi.fn() }} busy={false} onReview={onReview} onSave={onSave} onDecision={onDecision} />)
    return { ...view, onSave, onDecision }
  }
  function pendingChange(overrides = {}) {
    return { id: 'TEST proposal', baseVersion: 1, sections: { ...global.sections, findings: 'TEST finding' }, sourceThread: 'research', author: 'research', state: 'pending' as const, version: null, at: '2026-10-01', fileRef: null, sourceRefs: [], ...overrides }
  }
  it('shows the version caption and section blocks with empty states', () => {
    renderPanel()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('Scope text')).toBeInTheDocument()
    expect(screen.getByText('Owner decision')).toBeInTheDocument()
    expect(screen.getAllByText('Not set yet')).toHaveLength(2)
  })
  it('lists pending updates with a review action each', async () => {
    const user = userEvent.setup(), onReview = vi.fn()
    renderPanel({ ...global, changes: [pendingChange()] }, onReview)
    expect(screen.getByText('1 update waiting for review')).toBeInTheDocument()
    expect(screen.getByText('Shared context update')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review Shared context update' }))
    expect(onReview).toHaveBeenCalledWith('TEST proposal')
  })
  it('discards the draft when cancelling the editor', async () => {
    const user = userEvent.setup()
    const { onSave } = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Edit global context' }))
    await user.type(screen.getByRole('textbox', { name: 'Decisions' }), ' TEST discarded')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Edit global context' })).not.toBeInTheDocument()
  })
  it('warns when the context changed under an open editor', async () => {
    const user = userEvent.setup()
    const view = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Edit global context' }))
    view.rerender(<GlobalContextPanel resource={{ status: 'ready', refresh: vi.fn(), data: { ...global, version: 2 } }} preview={{ status: 'loading', refresh: vi.fn() }} busy={false} onReview={vi.fn()} onSave={vi.fn(async () => true)} onDecision={vi.fn(async () => true)} />)
    expect(screen.getByText(/Editing v1 · current is v2/)).toBeVisible()
  })
  it('disables approval for reviews based on an older version', async () => {
    const user = userEvent.setup()
    renderPanel({ ...global, version: 2, changes: [pendingChange()] })
    await user.click(screen.getByRole('button', { name: 'Review Shared context update' }))
    const approve = screen.getByRole('button', { name: 'Approve', exact: true })
    expect(approve).toBeDisabled()
    expect(approve.parentElement).toHaveAttribute('title', 'This update is based on an older version.')
  })
  it('shows a visible stale notice above the review actions', async () => {
    const user = userEvent.setup()
    renderPanel({ ...global, version: 3, changes: [pendingChange({ baseVersion: 2 })] })
    await user.click(screen.getByRole('button', { name: 'Review Shared context update' }))
    expect(screen.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
    expect(screen.getByText('This update is based on v2; the current version is v3. Ask for a refreshed proposal.')).toBeVisible()
  })
  it('lists revisions with status and expandable sections', async () => {
    const user = userEvent.setup()
    renderPanel({ ...global, changes: [pendingChange({ id: 'TEST revision', author: 'Owner', state: 'approved', version: 2, at: new Date(Date.now() - 3_600_000).toISOString(), sections: { ...global.sections, findings: 'TEST approved finding' } })] })
    await user.click(screen.getByRole('button', { name: 'Context history' }))
    expect(screen.getByText('Approved')).toBeVisible()
    expect(screen.getByText('1h ago')).toBeVisible()
    expect(screen.queryByText('TEST approved finding')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Owner/ }))
    expect(screen.getByText('TEST approved finding')).toBeVisible()
  })
})

describe('local context editor v2', () => {
  function localData(overrides = {}) {
    return { threadKey: 'TEST thread', notes: '', summary: '', coveredSeq: 0, version: 1, ...overrides }
  }
  function renderEditor(data = localData(), extra = {}) {
    return render(<LocalContextEditor resource={{ status: 'ready', refresh: vi.fn(), data }} busy={false} onSave={vi.fn()} onCompact={vi.fn()} {...extra} />)
  }
  it('shows token usage against budget and window', () => {
    renderEditor(localData({ usage: { inputTokens: 48210, budget: 100000, window: 200000, method: 'exact' } }))
    expect(screen.getByText('48,210 of 100,000 tokens')).toBeInTheDocument()
    expect(screen.getByText('Window 200,000')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Context usage' })).toHaveAttribute('aria-valuenow', '48')
    expect(screen.getByText('No stored summary yet')).toBeInTheDocument()
  })
  it('marks estimated usage honestly', () => {
    renderEditor(localData({ usage: { inputTokens: 0, budget: 0, window: 0, method: 'estimated' } }))
    expect(screen.getByText('Usage (estimated)')).toBeInTheDocument()
  })
  it('jumps to the chat input when continuing in a new conversation', async () => {
    const user = userEvent.setup()
    const composer = document.createElement('textarea')
    composer.id = 'karbot-composer'
    document.body.appendChild(composer)
    const scroll = vi.fn()
    composer.scrollIntoView = scroll
    renderEditor(localData({ contextBlocked: 'TEST hidden source blocks new assembly' }))
    await user.click(screen.getByRole('button', { name: 'Continue in a new conversation' }))
    composer.remove()
    expect(scroll).toHaveBeenCalledOnce()
  })
})
