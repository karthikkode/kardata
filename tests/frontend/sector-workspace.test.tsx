import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  expect(screen.getByText('1.5 active minutes recorded across research runs')).toBeInTheDocument()
  expect(screen.getByText('Estimate pending')).toBeInTheDocument()
})
it.each(['complete', 'failed'] as const)('does not present an empty %s ledger as future work', (state) => {
  render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, state } }} />)
  expect(screen.getByText('No work-item ledger was recorded for this run. Saved companies and conversations remain available.')).toBeInTheDocument()
  expect(screen.queryByText('Work items appear when the approved research starts.')).not.toBeInTheDocument()
  expect(screen.queryByText(/estimate becomes available/)).not.toBeInTheDocument()
})
describe('sector landing', () => {
  it.each([
    ['draft','Company research has not started yet.'], ['planning','Company research has not started yet.'], ['planned','Company research has not started yet.'], ['approved','Company research has not started yet.'],
    ['running','Companies will appear as research discovers them.'], ['paused','Companies will appear as research discovers them.'], ['failed','No companies were recorded before research stopped.'], ['complete','Research completed without discovering companies.'],
  ] as const)('states the real empty company case for %s', (state, copy) => {
    render(<SectorLanding sector={{ ...sector, state }} status="ready" config={null} progress={progress} onOpen={vi.fn()} onBack={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View progress' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
  })
  it('opens progress separately from the workspace', async () => {
    const user = userEvent.setup(), onOpen = vi.fn()
    render(<SectorLanding sector={sector} status="ready" config={null} progress={progress} onOpen={onOpen} onBack={vi.fn()} onRetry={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'View progress' }))
    expect(screen.getByRole('dialog', { name: 'Research progress' })).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close Research progress' }))
    await user.click(screen.getByRole('button', { name: 'Open', exact: true }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
describe('workspace state and resource interactions', () => {
  it('keeps thousand-item progress reachable through search and bounded windows with source links', async () => {
    const user = userEvent.setup()
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: `work-${i}`, title: `TEST company ${i}`, kind: 'company' as const, state: 'complete' as const, attempts: 1, childId: null, evidence: [], detail: 'Discovered from source', sourceUrl: `https://company-${i}.example.test/` }))
    render(<PlanProgress resource={{ ...progress, data: { ...progress.data!, items, completed: 1000, total: 1000 } }} />)
    expect(screen.getByText('Showing 50 of 1000 work items')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more work items' }))
    expect(screen.getByText('Showing 100 of 1000 work items')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search research work' }), 'TEST company 999')
    expect(screen.getByText('Showing 1 of 1 work items')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Company source' })).toHaveAttribute('href', 'https://company-999.example.test/')
    await user.clear(screen.getByRole('textbox', { name: 'Search research work' }))
    await user.type(screen.getByRole('textbox', { name: 'Search research work' }), 'No matching company')
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
    await user.click(screen.getByRole('button', { name: 'Reveal TEST hidden.md' }))
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
  expect(screen.getByText('Operation needs review')).toBeVisible()
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
  await user.click(screen.getByRole('button', { name: 'File-derived context update Review' }))
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
