import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlanProgress } from '../../frontend/src/components/workspace-parts'
import type { ResearchProgress } from '../../frontend/src/data/api/progress'
const item = { id: 'TEST:v1:intake:test', kind: 'discovery' as const, title: 'TEST uncertain candidate', state: 'blocked' as const, attempts: 3, childId: null, evidence: ['https://example.com/TEST-source'], sourceUrl: 'https://example.com/', detail: 'uncertain: TEST Australia evidence missing', receiptVersion: 'a'.repeat(64) }
const data: ResearchProgress = { sectorId: 'TEST', state: 'paused', planVersion: 1, items: [item], completed: 0, total: 1, unresolved: 1, discoveryClosed: false, estimatedPercent: null }
const resource = { status: 'ready' as const, data, refresh: vi.fn() }
describe('owner intake review', () => {
  it('shows the exact receipt and keeps owner reason on failure, then submits explicit exclusion', async () => {
    const user = userEvent.setup(), decide = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const review = { busy: false, error: null, clearError: vi.fn(), decide }
    render(<PlanProgress resource={resource} review={review} />)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('dialog', { name: 'Review candidate intake' })).toBeVisible()
    expect(screen.getByText('Plan v1 · Blocked · 3 attempts')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Saved intake evidence' })).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: 'Owner reason' }), 'TEST owner decision')
    await user.click(screen.getByRole('button', { name: 'Exclude candidate' }))
    expect(screen.getByRole('textbox', { name: 'Owner reason' })).toHaveValue('TEST owner decision')
    await user.click(screen.getByRole('button', { name: 'Exclude candidate' }))
    expect(decide).toHaveBeenLastCalledWith(item.id, 1, item.receiptVersion, 'exclude', 'TEST owner decision')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('retains draft through stale and denied states; latest receipt must be explicitly reviewed', async () => {
    const user = userEvent.setup(), review = { busy: false, error: 'TEST permission denied', clearError: vi.fn(), decide: vi.fn() }
    const view = render(<PlanProgress resource={resource} review={review} />)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.type(screen.getByRole('textbox', { name: 'Owner reason' }), 'TEST saved reason')
    view.rerender(<PlanProgress resource={{ ...resource, status: 'denied' }} review={review} />)
    expect(screen.getByRole('textbox', { name: 'Owner reason' })).toHaveValue('TEST saved reason')
    expect(screen.getByRole('button', { name: 'Retry candidate' })).toBeDisabled()
    view.rerender(<PlanProgress resource={{ ...resource, data: { ...data, items: [{ ...item, receiptVersion: 'b'.repeat(64) }] } }} review={review} />)
    expect(screen.getByRole('button', { name: 'Retry candidate' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Review latest receipt' }))
    expect(screen.getByRole('button', { name: 'Retry candidate' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Owner reason' })).toHaveValue('TEST saved reason')
  })
  it.each(['loading','error','offline'] as const)('retains the review reason through %s and blocks decisions', async (status) => {
    const user = userEvent.setup(), review = { busy: false, error: null, clearError: vi.fn(), decide: vi.fn() }
    const view = render(<PlanProgress resource={resource} review={review} />)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.type(screen.getByRole('textbox', { name: 'Owner reason' }), 'TEST retained reason')
    view.rerender(<PlanProgress resource={{ ...resource, status, error: 'TEST unavailable' }} review={review} />)
    expect(screen.getByRole('textbox', { name: 'Owner reason' })).toHaveValue('TEST retained reason')
    expect(screen.getByRole('button', { name: 'Exclude candidate' })).toBeDisabled()
  })
  it('cannot decide during saving or on running research', async () => {
    const user = userEvent.setup(), review = { busy: false, error: null, clearError: vi.fn(), decide: vi.fn() }
    const view = render(<PlanProgress resource={resource} review={review} />)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.type(screen.getByRole('textbox', { name: 'Owner reason' }), 'TEST explicit reason')
    view.rerender(<PlanProgress resource={resource} review={{ ...review, busy: true }} />)
    const retrying = screen.getByRole('button', { name: 'Retry candidate' })
    expect(retrying).toBeDisabled()
    expect(retrying).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Exclude candidate' })).toBeDisabled()
    view.rerender(<PlanProgress resource={{ ...resource, data: { ...data, state: 'running' } }} review={review} />)
    expect(screen.getByRole('button', { name: 'Exclude candidate' })).toBeDisabled()
    expect(screen.getByText('Pause research and wait for the candidate child to stop before deciding.')).toBeVisible()
  })

})
