import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SupervisionAlertsPanel } from '@/components/SupervisionAlertsPanel'
import type { Resource } from '@/data/useWorkspace'
import type { SupervisionAlert, SupervisionAlertsPage } from '@/data/alerts'
const item: SupervisionAlert = { seq: 5, at: '2026-10-01T00:00:00.000Z', kind: 'closed-owner', severity: 'high', subject: 'TEST owning execution ended with work leased', threadKey: 'agent:TEST child', sectorId: 'TEST sector', sessionId: 'TEST session', resolvedAt: null, state: 'current-warning' }
const historical: SupervisionAlert = { ...item, seq: 4, kind: 'missing-heartbeat', severity: 'warning', subject: 'TEST heartbeat flatline', state: 'historical', sectorId: null }
const ready = (items: SupervisionAlert[] = [], nextBeforeSeq: number | null = null): Resource<SupervisionAlertsPage> => ({ status: 'ready', data: { items, nextBeforeSeq }, refresh: vi.fn() })
const props = { viewingOlder: false, onOlder: vi.fn(), onLatest: vi.fn(), onOpenConversation: vi.fn() }
it('shows All clear on the current tab and an honest empty on history', async () => {
  render(<SupervisionAlertsPanel resource={ready()} {...props} />)
  expect(screen.getByText('All clear')).toBeVisible()
  expect(screen.getByText('No current warnings for your sessions.')).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'History' }))
  expect(screen.getByText('No supervision observations recorded for your sessions.')).toBeVisible()
  expect(screen.queryByText(/Current warning/)).not.toBeInTheDocument()
})
for (const status of ['loading', 'denied', 'offline', 'error'] as const) it(`shows ${status} without leaking retained warning rows`, () => {
  const resource: Resource<SupervisionAlertsPage> = { ...ready([item]), status, error: 'TEST alert service unavailable' }
  render(<SupervisionAlertsPanel resource={resource} {...props} />)
  expect(screen.queryByText('Owning execution ended')).not.toBeInTheDocument()
  if (status === 'loading') expect(screen.getByRole('status', { name: 'Alerts is loading' })).toBeVisible()
  else expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})
it('denies with the plural key copy', () => {
  render(<SupervisionAlertsPanel resource={{ ...ready([item]), status: 'denied' }} {...props} />)
  expect(screen.getByText('Alerts are not shared with this key. Ask an owner for access, then try again.')).toBeVisible()
})
it('filters the current tab to live warnings and opens conversations without reload links', async () => {
  const onOpenConversation = vi.fn()
  render(<SupervisionAlertsPanel resource={ready([item, historical])} {...props} onOpenConversation={onOpenConversation} />)
  expect(screen.getByText('Owning execution ended')).toBeVisible()
  expect(screen.queryByText('Heartbeat needs review')).not.toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
  expect(onOpenConversation).toHaveBeenCalledOnce()
  expect(onOpenConversation).toHaveBeenCalledWith(item)
  await userEvent.click(screen.getByRole('tab', { name: 'History' }))
  expect(screen.getByText('Heartbeat needs review')).toBeVisible()
  expect(screen.getByText(/Match thread agent:TEST child/)).toBeVisible()
})
it('pages explicitly and returns to latest without modifying work', async () => {
  const older = vi.fn(), latest = vi.fn()
  render(<SupervisionAlertsPanel resource={ready([item], 5)} viewingOlder onOlder={older} onLatest={latest} onOpenConversation={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Older alerts' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Current' }))
  expect(older).toHaveBeenCalledOnce(); expect(latest).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: /Resume|Cancel|Approve/ })).not.toBeInTheDocument()
})
