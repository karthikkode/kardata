import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExecutablePlanDetails, PlanBriefTimeline, ResearchPlanEditor, splitBriefSections } from '@/components/ResearchPlanEditor'
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

describe('executable plan presentation contract', () => {
  const longQuery = `Australian manufacturers ${'with cited evidence '.repeat(18)}`.slice(0, 300)
  const targetPlan: ExecutableResearchPlan = {
    ...executable,
    discoveryTarget: 500,
    discovery: [{ id: 'au', title: 'Australian SMEs', queries: [longQuery], maxPages: 2 }],
    companyBrief: `Verify identity. ${'Keep uncertain claims explicit. '.repeat(30)}`,
  }

  it('renders full queries as numbered rows without a completion bar', () => {
    const { container } = render(<ExecutablePlanDetails plan={targetPlan} />)
    expect(screen.getByText(longQuery)).toBeInTheDocument()
    expect(screen.getByText(longQuery).closest('li')).not.toHaveClass('truncate')
    expect(screen.getByRole('region', { name: 'Executable research work' })).toHaveTextContent('Target 500 of up to 2,000 companies')
    expect(container.querySelector('[style*="width"]')).toBeNull()
  })

  it('lists acceptance as neutral numbered requirements', () => {
    render(<ExecutablePlanDetails plan={executable} />)
    const region = screen.getByRole('region', { name: 'Acceptance criteria' })
    const items = within(region).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent(executable.acceptance[0]!)
  })

  it('discloses long instructions behind an explicit control', async () => {
    const user = userEvent.setup()
    render(<ExecutablePlanDetails plan={targetPlan} />)
    const toggle = screen.getByRole('button', { name: 'Show full instructions' })
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('keeps blank numerics editable and reports field errors with a focused summary', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => true)
    render(<ResearchPlanEditor markdown="Plan" executable={executable} busy={false} error={null} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Edit plan' }))
    const limit = screen.getByLabelText('Company limit')
    await user.clear(limit)
    expect((limit as HTMLInputElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByText('Enter a company limit from 1 to 2000.')).toHaveLength(2)
    const summary = screen.getByText('Fix this field before saving.').closest('[role="alert"]')!
    expect(summary).toHaveTextContent('Enter a company limit from 1 to 2000.')
    expect(summary).toHaveFocus()
  })
  it('rejects a cleared discovery target instead of defaulting to one', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => true)
    const discovery = {
      ...executable,
      researchDepth: 'discovery' as const,
      discoveryTarget: 500,
    }
    render(<ResearchPlanEditor markdown="Plan" executable={discovery} busy={false} error={null} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Edit plan' }))
    const target = screen.getByLabelText('Discovery target')
    expect(target).toHaveValue(500)
    await user.clear(target)
    expect((target as HTMLInputElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByText('Enter a discovery target from 1 to 2000.').length).toBeGreaterThan(0)
    expect(screen.getByRole('dialog', { name: 'Edit research plan' })).toBeInTheDocument()
  })
  it('leaves a never-set discovery target unset instead of erroring', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => true)
    const discovery = { ...executable, researchDepth: 'discovery' as const }
    render(<ResearchPlanEditor markdown="Plan" executable={discovery} busy={false} error={null} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Edit plan' }))
    expect(screen.getByLabelText('Discovery target')).toHaveValue(null)
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).not.toContain('discoveryTarget')
  })
})

describe('narrative brief timeline', () => {
  const brief = 'Intro line.\n\n## scope\n\nJourney sector, owner-edited.\n\n### direction shards\n\nPayments.\n\n## Custom heading\n\nAnything goes.\n\n```\n## not a heading\n```\n\n## budgets\n\n'

  it('splits heading-led sections while preserving every line', () => {
    const { intro, sections } = splitBriefSections(brief)
    expect(intro).toBe('Intro line.')
    expect(sections.map((section) => [section.heading, section.level])).toEqual([
      ['scope', 2],
      ['direction shards', 3],
      ['Custom heading', 2],
      ['budgets', 2],
    ])
    expect(sections[0]?.body).toBe('Journey sector, owner-edited.')
    expect(sections[2]?.body).toBe('Anything goes.\n\n```\n## not a heading\n```')
    expect(sections[3]?.body).toBe('')
  })

  it('renders every section with a medallion and intact text', () => {
    render(<PlanBriefTimeline text={brief} />)
    expect(screen.getByText('Intro line.')).toBeInTheDocument()
    for (const heading of ['scope', 'direction shards', 'Custom heading', 'budgets']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    expect(screen.getByText('Journey sector, owner-edited.')).toBeInTheDocument()
    expect(screen.getByText('## not a heading')).toBeInTheDocument()
  })

  it('falls back to plain markdown without sections', () => {
    render(<PlanBriefTimeline text={'Just prose, no headings.'} />)
    expect(screen.getByText('Just prose, no headings.')).toBeInTheDocument()
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
