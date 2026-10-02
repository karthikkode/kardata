import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionFilesView, type ChatFile } from '@/components/ChatPanel'
import type { StagingConfig } from '@/data/staging-api'

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
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the file preview.')
    expect(screen.queryByText('Could not load the file preview.', { selector: 'p:not([role])' })).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    await waitFor(() => expect(screen.getByText('SECOND FILE BODY')).toBeInTheDocument())
    releaseFirst()
    await waitFor(() => expect(screen.queryByText('Loading file preview…')).not.toBeInTheDocument())
    expect(screen.queryByText('FIRST FILE BODY')).not.toBeInTheDocument()
    expect(screen.getByText('SECOND FILE BODY')).toBeInTheDocument()
  })

  it('surfaces download failures instead of swallowing them', async () => {
    stubBody(() => ({ status: 500, body: { ok: false, error: { code: 'internal', message: 'no' } } }))
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download notes.md' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Download of notes.md failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders loaded content and empty files honestly', async () => {
    stubBody((id) => ({
      status: 200,
      body: { ok: true, data: { body: id === 'f-1' ? '# Loaded' : '' } },
    }))
    render(<SessionFilesView config={config} sessionId="s-1" files={files} onRefresh={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview notes.md' }))
    await waitFor(() => expect(screen.getByText('Loaded')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Close file preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview brief.md' }))
    await waitFor(() => expect(screen.getByText('Empty file.')).toBeInTheDocument())
  })
})
