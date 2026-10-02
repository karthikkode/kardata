import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionInspector } from '@/components/ExecutionInspector'
import { getExecutionRecord, listExecutionRecords, type ExecutionRecordMetadata, type ExecutionRecordPage } from '@/data/workspace-api'
import type { Resource } from '@/data/useWorkspace'

const entry: ExecutionRecordMetadata = { seq: 12, at: '2026-10-01T00:00:00Z', runKey: 'TEST original operation', attemptLease: 'a8f8c1d9-8d8f-4e0c-a929-941f672b35b0', round: 2, kind: 'request', workflowId: 'TEST workflow', executionId: 'TEST actual execution', ref: { hash: 'a'.repeat(64), bytes: 80000 } }
const page: Resource<ExecutionRecordPage> = { status: 'ready', refresh: vi.fn(), data: { records: [entry], nextAfterSeq: 12 } }
const body = { status: 'ready' as const, refresh: vi.fn(), data: { record: { version: 1, provider: 'TEST provider', model: 'TEST model', round: 2, boundary: { contextVersion: 3, planVersion: 4, localVersion: 0 }, data: { prompt: 'TEST evidence '.repeat(10000) } } } }
const props = { page, body, selectedSeq: null as number | null, hasPrevious: false, onSelect: vi.fn(), onNext: vi.fn(), onPrevious: vi.fn(), onClose: vi.fn() }
afterEach(() => vi.unstubAllGlobals())

it('selects recorded boundaries and pages with truthful controls', async () => {
  const user = userEvent.setup()
  render(<ExecutionInspector {...props} />)
  await user.click(screen.getByRole('button', { name: 'Request · Round 2 · #12' }))
  expect(props.onSelect).toHaveBeenCalledWith(12)
  expect(screen.getByRole('button', { name: 'Previous records' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Next records' }))
  expect(props.onNext).toHaveBeenCalledOnce()
})
it('bounds long JSON display, labels observed versions and exposes complete-download intent', async () => {
  const user = userEvent.setup()
  render(<ExecutionInspector {...props} selectedSeq={12} />)
  expect(screen.getByLabelText('Normalized execution JSON').textContent?.length).toBe(64000)
  expect(screen.getByText('Shared plan observed')).toBeInTheDocument()
  expect(screen.getByText('Local context observed')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Show more record text' }))
  expect(screen.getByLabelText('Normalized execution JSON').textContent?.length).toBe(128000)
  await user.click(screen.getByText('Execution identity'))
  expect(screen.getByText('TEST actual execution')).toBeInTheDocument()
})
it.each(['loading', 'error', 'denied', 'offline'] as const)('shows the %s state without mounting historical JSON', (status) => {
  render(<ExecutionInspector {...props} selectedSeq={12} page={{ ...page, status, error: 'TEST history unavailable' }} />)
  if (status === 'loading') expect(screen.getByRole('status', { name: 'Execution inspection is loading' })).toBeInTheDocument()
  else expect(screen.getByRole('alert')).toHaveTextContent(status === 'denied' ? 'Execution inspection is not shared' : status === 'offline' ? 'No connection' : 'TEST history unavailable')
  expect(screen.queryByLabelText('Normalized execution JSON')).not.toBeInTheDocument()
})
it('keeps empty history separate from a stored-body failure', () => {
  const view = render(<ExecutionInspector {...props} page={{ ...page, data: { records: [], nextAfterSeq: null } }} />)
  expect(screen.getByText('No execution records have been saved for this conversation.')).toBeInTheDocument()
  view.rerender(<ExecutionInspector {...props} selectedSeq={12} body={{ status: 'error', refresh: vi.fn(), error: 'TEST archived content is missing or corrupt' }} />)
  expect(screen.getByRole('alert')).toHaveTextContent('TEST archived content is missing or corrupt')
  expect(screen.queryByLabelText('Normalized execution JSON')).not.toBeInTheDocument()
})
it('validates bounded client pages and encodes thread identities', async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, data: page.data })))
  vi.stubGlobal('fetch', fetch)
  expect(await listExecutionRecords({ baseUrl: 'https://TEST-api.example', apiKey: 'TEST key' }, 'agent:TEST child', 10)).toEqual(page.data)
  expect(fetch.mock.calls[0]?.[0]).toContain('/threads/agent%3ATEST%20child/execution-records?afterSeq=10&limit=20')
})
it.each([{ record: [] }, { record: null }])('rejects a malformed archived body: %j', async (data) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data }))))
  await expect(getExecutionRecord({ baseUrl: 'https://TEST-api.example', apiKey: 'TEST key' }, 'TEST thread', 12)).rejects.toMatchObject({ code: 'invalid_response' })
})

it('rejects metadata containing private storage keys or invalid time/lease identities', async () => {
  const config = { baseUrl: 'https://TEST-api.example', apiKey: 'TEST key' }
  for (const malformed of [{ ...entry, ref: { ...entry.ref, key: 'TEST private storage key' } }, { ...entry, at: 'TEST invalid timestamp' }, { ...entry, attemptLease: 'TEST invalid lease' }]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { records: [malformed], nextAfterSeq: null } }))))
    await expect(listExecutionRecords(config, 'TEST thread')).rejects.toMatchObject({ code: 'invalid_response' })
  }
})
