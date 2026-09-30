import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SectorLanding } from '@/components/SectorLanding'
import { GlobalContextPanel, LocalContextEditor, ResourceNotice, WorkspaceFiles } from '@/components/workspace-parts'
import type { SectorDetail } from '@/data/staging-api'
import type { GlobalContext, ResearchProgress } from '@/data/workspace-api'
import type { Resource } from '@/data/useWorkspace'

const sector: SectorDetail = { id: 'test-sector', name: 'TEST sector', topic: 'Topic', state: 'draft', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, researchSessionId: null, createdAt: '2026-09-30', updatedAt: '2026-09-30' }
const progress: Resource<ResearchProgress> = { status: 'ready', refresh: vi.fn(), data: { sectorId: sector.id, state: 'draft', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null } }
const global: GlobalContext = { sectorId: sector.id, version: 1, researchSessionId: 'research', sections: { scope: 'Scope text', decisions: 'Owner decision', findings: '', questions: '' }, markdown: '## Scope\nScope text', changes: [] }
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
    expect(screen.getByText('needs-ocr')).toBeInTheDocument()
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
