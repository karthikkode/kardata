import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { SessionFilesView, type ChatFile } from '@/components/ChatPanel'
import type { StagingConfig } from '@/data/staging-api'

vi.mock('sonner', () => {
  const toastFn = vi.fn()
  return {
    toast: Object.assign(toastFn, { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  }
})

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }
const files: ChatFile[] = [
  { id: 'f-1', name: 'notes.md', source: 'Research agent', detail: '' },
  { id: 'f-2', name: 'brief.md', source: 'Uploaded', detail: '' },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubBody(handler: (id: string) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const match = String(url).match(/\/artifacts\/([^/?]+)\/body/)
      const result = handler(match?.[1] ?? '')
      return { ok: result.status < 300, status: result.status, json: async () => result.body }
    }),
  )
}

describe('SessionFilesView failure states', () => {
  it('keeps preview failures out of the file content with a retry', async () => {
    stubBody(() => ({ status: 500, body: { ok: false, error: { code: 'internal', message: 'no' } } }))
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview notes.md' }))
    expect(await screen.findByRole('dialog', { name: 'File preview' })).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the file preview.')
    expect(within(alert).getByText(/Could not load the file preview\./)).toBeInTheDocument()
    expect(screen.getAllByText(/Could not load the file preview\./)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    const retried = await screen.findByRole('alert')
    expect(retried).toHaveTextContent('Could not load the file preview.')
  })

  it('never lets a stale preview overwrite the current file', async () => {
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/artifacts/f-1/body')) await gate
        const id = String(url).match(/\/artifacts\/([^/?]+)\/body/)?.[1] ?? ''
        const body = id === 'f-1' ? 'FIRST FILE BODY' : 'SECOND FILE BODY'
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { body } }) }
      }),
    )
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview notes.md' }))
    expect(await screen.findByRole('status', { name: 'Loading file preview' })).toBeInTheDocument()
    // The modal preview blocks the list: close, then open the second file
    // while the first request is still gated.
    fireEvent.click(screen.getByRole('button', { name: 'Close File preview' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview brief.md' }))
    await waitFor(() => expect(screen.getByText('SECOND FILE BODY')).toBeInTheDocument())
    releaseFirst()
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading file preview' })).not.toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('FIRST FILE BODY')).not.toBeInTheDocument()
    expect(screen.getByText('SECOND FILE BODY')).toBeInTheDocument()
  })

  it('toasts download failures instead of swallowing them', async () => {
    stubBody(() => ({ status: 500, body: { ok: false, error: { code: 'internal', message: 'no' } } }))
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download notes.md' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Download of notes.md failed. The file is kept. Try again.', { duration: 8000 })
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('toasts when a download needs a backend connection', async () => {
    render(<SessionFilesView config={null} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download notes.md' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Download of notes.md needs a backend connection.', { duration: 8000 })
    })
  })

  it('renders loaded content and empty files honestly', async () => {
    stubBody((id) => ({
      status: 200,
      body: { ok: true, data: { body: id === 'f-1' ? '# Loaded' : '' } },
    }))
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview notes.md' }))
    await waitFor(() => expect(screen.getByText('Loaded')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Close File preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    await waitFor(() => expect(screen.getByText('Empty file.')).toBeInTheDocument())
  })
})

describe('SessionFilesView file creation', () => {
  function stubCreate(handler: (body: Record<string, unknown>) => { status: number; payload: unknown }): { calls: Array<{ url: string; body: string }> } {
    const calls: Array<{ url: string; body: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        calls.push({ url: String(url), body: init?.body ?? '' })
        const result = handler(JSON.parse(init?.body ?? '{}') as Record<string, unknown>)
        return { ok: result.status < 300, status: result.status, json: async () => result.payload }
      }),
    )
    return { calls }
  }

  it('creates a file through the API and refreshes the list', async () => {
    const onRefresh = vi.fn()
    const { calls } = stubCreate(() => ({ status: 201, payload: { ok: true, data: { id: 'f-3' } } }))
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'New file' }))
    expect(await screen.findByRole('dialog', { name: 'New file' })).toBeInTheDocument()
    expect(screen.getByText('Include an extension, e.g. notes.md')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'plan.md' } })
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: '# Plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/v1/sessions/s-1/artifacts'))).toBe(true)
    })
    const posted = calls.find((call) => call.url.endsWith('/v1/sessions/s-1/artifacts'))
    expect(posted?.body).toBe(JSON.stringify({ name: 'plan.md', content: '# Plan', kind: 'file', reason: 'user_upload' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New file' })).not.toBeInTheDocument()
    })
    expect(onRefresh).toHaveBeenCalled()
  })

  it('disables creation for a blank name and keeps failures inline', async () => {
    const { calls } = stubCreate(() => ({ status: 500, payload: { ok: false, error: { code: 'internal', message: 'no' } } }))
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'New file' }))
    expect(await screen.findByRole('dialog', { name: 'New file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create file' })).toBeDisabled()
    expect(calls).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'plan.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    expect(await screen.findByText('Could not create the file.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'New file' })).toBeInTheDocument()
  })
})
