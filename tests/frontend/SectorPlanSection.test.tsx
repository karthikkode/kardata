// Sector plan panel: the versioned research plan artifact with its
// lifecycle states. Artifact answers are stubbed; no fixture imports.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectorPlanSection } from '@/components/SectorPlanSection'
import type { StagingConfig } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

const PLAN = {
  sectorId: 'sec-foods',
  versions: [{ version: 1, markdown: '## scope\nFoods.', at: '2026-09-30T00:00:00.000Z' }],
  latest: { version: 1, markdown: '## scope\nFoods.', at: '2026-09-30T00:00:00.000Z' },
}

function stubPlan(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload })),
  )
}

function renderSection(
  props: {
    sectorState?: 'draft' | 'planning' | 'planned' | 'approved' | 'running' | 'failed'
    researchBusy?: boolean
    planError?: string | null
    onPlan?: () => Promise<void>
    onApprove?: (version: number) => Promise<void>
    onEdit?: (markdown: string) => Promise<void>
  } = {},
) {
  return render(
    <SectorPlanSection
      config={config}
      sectorId="sec-foods"
      sectorName="Speciality Foods"
      sectorState={props.sectorState ?? 'planned'}
      researchBusy={props.researchBusy ?? false}
      planError={props.planError ?? null}
      onPlan={props.onPlan ?? (async () => undefined)}
      onApprove={props.onApprove ?? (async () => undefined)}
      onEdit={props.onEdit ?? (async () => undefined)}
    />,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('SectorPlanSection', () => {
  it('shows a loading skeleton while the plan loads', async () => {
    stubPlan(new Promise(() => undefined))
    renderSection()
    expect(await screen.findByLabelText('Research plan is loading')).toBeInTheDocument()
  })

  it('renders the latest version with its version tag', async () => {
    stubPlan({ ok: true, data: PLAN })
    renderSection()
    expect(await screen.findByText('Research plan')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByLabelText('Edit plan')).toHaveValue('## scope\nFoods.')
  })

  it('invites planning on drafts without a plan', async () => {
    stubPlan({ ok: true, data: { sectorId: 'sec-foods', versions: [], latest: null } })
    renderSection({ sectorState: 'draft' })
    expect(await screen.findByText(/No research plan yet/)).toBeInTheDocument()
  })

  it('starts planning from the panel', async () => {
    stubPlan({ ok: true, data: { sectorId: 'sec-foods', versions: [], latest: null } })
    const onPlan = vi.fn(async () => undefined)
    renderSection({ sectorState: 'draft', onPlan })
    fireEvent.click(await screen.findByRole('button', { name: 'Plan research' }))
    await waitFor(() => expect(onPlan).toHaveBeenCalledTimes(1))
  })

  it('shows plan errors as alerts', async () => {
    stubPlan({ ok: true, data: { sectorId: 'sec-foods', versions: [], latest: null } })
    renderSection({ sectorState: 'draft', planError: 'Plan failed.' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan failed.')
  })

  it('denies with the lock notice on 403', async () => {
    stubPlan({ ok: false, error: { code: 'permission_denied', message: 'no' } }, 403)
    renderSection()
    expect(await screen.findByText(/not shared with this key/)).toBeInTheDocument()
  })
})

describe('SectorPlanSection approval', () => {
  it('approves the latest version from the panel', async () => {
    stubPlan({ ok: true, data: PLAN })
    const onApprove = vi.fn(async () => undefined)
    renderSection({ sectorState: 'planned', onApprove })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve v1' }))
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(1))
  })

  it('edits the plan text and saves a new version', async () => {
    stubPlan({ ok: true, data: PLAN })
    const onEdit = vi.fn(async () => undefined)
    renderSection({ sectorState: 'planned', onEdit })
    fireEvent.change(await screen.findByLabelText('Edit plan'), { target: { value: '## scope\nEdited.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save plan edit' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('## scope\nEdited.'))
  })

  it('edits after approval (re-opens review) and hides both once running', async () => {
    stubPlan({ ok: true, data: PLAN })
    const onEdit = vi.fn(async () => undefined)
    const approved = renderSection({ sectorState: 'approved', onEdit })
    expect(await approved.findByText('Research plan')).toBeInTheDocument()
    expect(approved.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    fireEvent.change(approved.getByLabelText('Edit plan'), { target: { value: '## scope\nEdited.' } })
    fireEvent.click(approved.getByRole('button', { name: 'Save plan edit' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('## scope\nEdited.'))
    approved.unmount()
    stubPlan({ ok: true, data: PLAN })
    const running = renderSection({ sectorState: 'running' })
    expect(await running.findByText('Research plan')).toBeInTheDocument()
    expect(running.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(running.queryByLabelText('Edit plan')).not.toBeInTheDocument()
    running.unmount()
  })
})
