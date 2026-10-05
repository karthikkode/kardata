import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResearchPlanTab } from '@/components/plan/PlanTab'
import type { ResearchActions } from '@/components/SectorWorkspace'
import type { WorkReview } from '@/components/workspace-parts'
import type { Resource } from '@/data/useWorkspace'
import type { ResearchState } from '@/data/api/sectors'
import type { SectorPlanView } from '@/data/api/plans'
import type { GlobalContext } from '@/data/api/context'
import type { ResearchProgress } from '@/data/api/progress'
import type { ExecutableResearchPlan } from '@/data/research-plan'

const executable: ExecutableResearchPlan = {
  researchDepth: 'company',
  discovery: [{ id: 'crews', title: 'Licensed commercial crews', queries: ['licensed electrician Parramatta commercial'], maxPages: 5 }],
  companyBrief: 'Record licensed crews with named sources.',
  budgets: { maxCompanies: 500, maxWallMinutes: 1440, concurrency: 2 },
  acceptance: ['Every company links to a fetched source.'],
}

const markdown = '## Goal\nMap the licensed crews.\n\n## Steps\n1. Search each direction.'

function planView(overrides: Partial<SectorPlanView> = {}): SectorPlanView {
  const latest = { version: 3, markdown, at: '2026-09-28T00:00:00.000Z', executable }
  return {
    sectorId: 'sec-1',
    versions: [
      { version: 2, markdown, at: '2026-09-25T00:00:00.000Z' },
      { version: 3, markdown, at: '2026-09-28T00:00:00.000Z' },
    ],
    latest,
    approvals: [3],
    approvedVersion: 3,
    ...overrides,
  }
}

function ready<T>(data: T): Resource<T> {
  return { status: 'ready', data, refresh: vi.fn() }
}

const progressData: ResearchProgress = {
  sectorId: 'sec-1', state: 'running', planVersion: 3, items: [],
  completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: 62,
}

const globalData: GlobalContext = {
  sectorId: 'sec-1', version: 2,
  sections: { scope: '', instructions: '', decisions: '', findings: '', questions: '' },
  markdown: '', researchSessionId: null, changes: [], files: [],
  usage: { total: 0, budget: 30000, method: 'estimated', bySection: { scope: 0, instructions: 0, decisions: 0, findings: 0, questions: 0 }, byFile: [] },
}

function actions(overrides: Partial<ResearchActions> = {}): ResearchActions {
  return {
    busy: false, error: null,
    plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    edit: vi.fn(async () => true),
    ...overrides,
  }
}

const review: WorkReview = { busy: false, error: null, clearError: vi.fn(), decide: vi.fn(async () => true) }

function renderTab(sectorState: ResearchState, plan: Resource<SectorPlanView>, extra: { progress?: Resource<ResearchProgress>; global?: Resource<GlobalContext>; actions?: ResearchActions } = {}) {
  const acts = extra.actions ?? actions()
  render(
    <ResearchPlanTab
      sectorState={sectorState}
      plan={plan}
      progress={extra.progress ?? ready(progressData)}
      global={extra.global ?? ready(globalData)}
      actions={acts}
      workReview={review}
    />,
  )
  return acts
}

describe('ResearchPlanTab header', () => {
  it('shows the approved badge, version and updated time without an approve action', () => {
    renderTab('approved', ready(planView()))
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('v3')).toBeInTheDocument()
    expect(screen.getByText(/Updated /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve v/ })).not.toBeInTheDocument()
  })

  it('approves the exact version with the shared context version', async () => {
    const user = userEvent.setup()
    const acts = renderTab('planned', ready(planView({ approvedVersion: null, approvals: [] })))
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve v3' }))
    expect(acts.approve).toHaveBeenCalledWith(3, 2)
  })

  it('blocks approval while shared context loads and explains why', async () => {
    const user = userEvent.setup()
    const acts = renderTab('planned', ready(planView({ approvedVersion: null, approvals: [] })), {
      global: { status: 'loading', refresh: vi.fn() },
    })
    const approve = screen.getByRole('button', { name: 'Approve v3' })
    expect(approve).toHaveAttribute('aria-disabled', 'true')
    await user.hover(approve)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Approval unlocks when shared context loads.')
    await user.click(approve)
    expect(acts.approve).not.toHaveBeenCalled()
  })

  it('labels unreviewed plans Draft with no lifecycle actions', () => {
    renderTab('draft', ready(planView({ approvedVersion: null, approvals: [] })))
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve v/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit plan' })).not.toBeInTheDocument()
  })

  it('starts research inline from the ready step once approved', async () => {
    const user = userEvent.setup()
    const acts = renderTab('approved', ready(planView()))
    await user.click(screen.getByRole('button', { name: 'Start research' }))
    expect(acts.start).toHaveBeenCalledTimes(1)
  })
})

describe('ResearchPlanTab brief and states', () => {
  it('warns on narrative-only plans and opens the editor from the warning', async () => {
    const user = userEvent.setup()
    const bare = planView()
    renderTab('planned', ready({ ...bare, latest: { ...bare.latest!, executable: undefined } }))
    const warning = screen.getByText(/no executable search steps yet/).closest('[role="alert"]')! as HTMLElement
    await user.click(within(warning).getByRole('button', { name: 'Edit plan' }))
    expect(screen.getByRole('dialog', { name: 'Edit research plan' })).toBeInTheDocument()
  })

  it('invites plan creation when no plan exists', async () => {
    const user = userEvent.setup()
    const acts = renderTab('draft', ready(planView({ versions: [], latest: null, approvals: [], approvedVersion: null })))
    expect(screen.getByText('No research plan yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create plan' }))
    expect(acts.plan).toHaveBeenCalledTimes(1)
  })

  it('shows the drafting state while planning', () => {
    renderTab('planning', ready(planView({ versions: [], latest: null, approvals: [], approvedVersion: null })), {
      actions: actions({ busy: true }),
    })
    expect(screen.getByText('Your research agent is drafting the plan.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create plan' })).not.toBeInTheDocument()
  })

  it('keeps the work ledger below the plan', () => {
    renderTab('running', ready(planView()))
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument()
  })
})
