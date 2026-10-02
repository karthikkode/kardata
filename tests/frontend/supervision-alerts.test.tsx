import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SupervisionAlertsPanel } from '@/components/SupervisionAlertsPanel'
import type { Resource } from '@/data/useWorkspace'
import type { SupervisionAlert, SupervisionAlertsPage } from '@/data/alerts'
const item: SupervisionAlert = { seq: 5, at: '2026-10-01T00:00:00.000Z', sessionId: 'TEST session', sessionTitle: 'TEST named conversation', threadKey: 'agent:TEST child', sectorId: 'TEST sector', kind: 'closed-owner', response: 'park', state: 'current-warning', threadStatus: 'PAUSED' }
const ready = (items: SupervisionAlert[] = [], nextBeforeSeq: number | null = null): Resource<SupervisionAlertsPage> => ({ status: 'ready', data: { items, nextBeforeSeq }, refresh: vi.fn() })
it('shows an honest empty state without claiming fleet health', () => {
  render(<SupervisionAlertsPanel resource={ready()} viewingOlder={false} onOlder={vi.fn()} onLatest={vi.fn()} />)
  expect(screen.getByText('No supervision observations recorded for your sessions.')).toBeVisible()
  expect(screen.queryByText(/Current warning/)).not.toBeInTheDocument()
})
for (const status of ['loading', 'denied', 'offline', 'error'] as const) it(`shows ${status} without leaking retained warning rows`, () => {
  const resource: Resource<SupervisionAlertsPage> = { ...ready([item]), status, error: 'TEST alert service unavailable' }
  render(<SupervisionAlertsPanel resource={resource} viewingOlder={false} onOlder={vi.fn()} onLatest={vi.fn()} />)
  expect(screen.queryByText('Owning execution ended')).not.toBeInTheDocument()
  if (status === 'loading') expect(screen.getByRole('status', { name: 'Alerts is loading' })).toBeVisible()
  else expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})
it('distinguishes confirmed recovery warnings from historical observations and encodes the scoped link', () => {
  render(<SupervisionAlertsPanel resource={ready([item, { ...item, seq: 4, kind: 'missing-heartbeat', state: 'historical', response: 'observe', sectorId: null }])} viewingOlder={false} onOlder={vi.fn()} onLatest={vi.fn()} />)
  expect(screen.getByText('Current warning · review paused work')).toBeVisible()
  expect(screen.getByText('Historical observation')).toBeVisible()
  const href = screen.getByRole('link', { name: 'Review conversation' }).getAttribute('href')!
  const query = new URL(href, 'http://localhost').searchParams
  expect(Object.fromEntries(query)).toEqual({ section: 'SectorChat', sector: 'TEST sector', session: 'TEST session', thread: 'agent:TEST child' })
  expect(screen.getByText(/match session TEST session/)).toBeVisible()
})
it('pages explicitly and returns to latest without modifying work', async () => {
  const older = vi.fn(), latest = vi.fn()
  render(<SupervisionAlertsPanel resource={ready([item], 5)} viewingOlder onOlder={older} onLatest={latest} />)
  await userEvent.click(screen.getByRole('button', { name: 'Older alerts' }))
  await userEvent.click(screen.getByRole('button', { name: 'Latest alerts' }))
  expect(older).toHaveBeenCalledOnce(); expect(latest).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: /Resume|Cancel|Approve/ })).not.toBeInTheDocument()
})
