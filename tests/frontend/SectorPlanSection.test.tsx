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
    expect(screen.getByText(/Foods/)).toBeInTheDocument()
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
