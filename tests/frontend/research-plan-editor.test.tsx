import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExecutablePlanDetails, ResearchPlanEditor } from '@/components/ResearchPlanEditor'
import type { ExecutableResearchPlan } from '@/data/research-plan'

const executable: ExecutableResearchPlan = { discovery: [{ id: 'au', title: 'Australian SMEs', queries: ['Australian manufacturers'], maxPages: 2 }], companyBrief: 'Verify identity and source evidence.', budgets: { maxCompanies: 2000, maxWallMinutes: 60, concurrency: 2 }, acceptance: ['Distinct Australian companies with fetched evidence'] }

describe('owner review of executable plans', () => {
  it('shows actual queries, limits, instructions and acceptance', () => {
    render(<ExecutablePlanDetails plan={executable} />)
    expect(screen.getByRole('region', { name: 'Executable research work' })).toBeInTheDocument()
    expect(screen.getByText(/2,000 companies/)).toBeInTheDocument()
    expect(screen.getByText('Australian manufacturers')).toBeInTheDocument()
    expect(screen.getByText(executable.acceptance[0]!)).toBeInTheDocument()
  })
  it('preserves failed edits across refreshed plan data and saves the reviewed work', async () => {
    const user = userEvent.setup(), onSave = vi.fn(async () => false)
    const props = { markdown: 'Original plan', executable, busy: false, error: null, onSave }
    const view = render(<ResearchPlanEditor {...props} />)
    await user.click(screen.getByRole('button', { name: 'Edit plan' }))
    await user.clear(screen.getByRole('textbox', { name: 'Plan', exact: true }))
    await user.type(screen.getByRole('textbox', { name: 'Plan', exact: true }), 'Owner draft')
    await user.type(screen.getByRole('textbox', { name: 'Queries for Australian SMEs' }), '\nAustralian wholesalers')
    view.rerender(<ResearchPlanEditor {...props} markdown="Background revision" error="Save failed. Try again." />)
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(screen.getByRole('dialog', { name: 'Edit research plan' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Plan', exact: true })).toHaveValue('Owner draft')
    expect(onSave.mock.calls[0]?.[0]).toContain('Australian wholesalers')
    expect(onSave.mock.calls[0]?.[0]).toContain('"maxCompanies":2000')
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed')
  })
  it('closes only after a successful save', async () => {
    const user = userEvent.setup()
    render(<ResearchPlanEditor markdown="Plan" executable={executable} busy={false} error={null} onSave={async () => true} />)
    await user.click(screen.getByRole('button', { name: 'Edit plan' }))
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('labels legacy plans honestly', async () => {
    const user = userEvent.setup()
    render(<ResearchPlanEditor markdown="Legacy" busy={false} error={null} onSave={async () => false} />)
    await user.click(screen.getByRole('button', { name: 'Edit plan' }))
    expect(screen.getByText(/legacy plan has no executable work/)).toBeInTheDocument()
  })
})

describe('plan version timeline', () => {
  it('stays hidden for a single version', async () => {
    const { PlanVersionTimeline } = await import('@/components/ResearchPlanEditor')
    const { container } = render(
      <PlanVersionTimeline versions={[{ version: 1, at: '2026-01-01T00:00:00.000Z' }]} latestVersion={1} approvedVersion={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists versions newest first with the approved badge', async () => {
    const user = userEvent.setup()
    const { PlanVersionTimeline } = await import('@/components/ResearchPlanEditor')
    render(
      <PlanVersionTimeline
        versions={[
          { version: 1, at: '2026-01-01T00:00:00.000Z' },
          { version: 2, at: '2026-01-02T00:00:00.000Z' },
        ]}
        latestVersion={2}
        approvedVersion={2}
      />,
    )
    await user.click(screen.getByText('Plan history'))
    const tags = screen.getAllByText(/^v[12]$/).map((el) => el.textContent)
    expect(tags).toEqual(['v2', 'v1'])
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })
})
