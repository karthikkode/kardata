import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { SectorFilePreview } from '@/components/SectorFilePreview'

const NativeUrl = URL
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function urls() {
  const create = vi.fn(() => 'blob:test-file'), revoke = vi.fn()
  const clicked: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push(this.download) })
  vi.stubGlobal('URL', class extends NativeUrl { static createObjectURL = create; static revokeObjectURL = revoke })
  return { create, revoke, clicked }
}

describe('sector file preview and downloads', () => {
  it('renders extracted content and provides the retained original download', async () => {
    const { create, revoke, clicked } = urls()
    const view = render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'test.md', mediaType: 'text/markdown', text: '# TEST evidence', contentBase64: btoa('# TEST evidence'), originalAvailable: true } }} />)
    expect(screen.getByRole('heading', { name: 'TEST evidence' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download original file' }))
    expect(clicked).toEqual(['test.md'])
    expect(create).toHaveBeenCalledOnce()
    view.unmount()
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:test-file'))
  })
  it('labels extracted-only legacy downloads honestly', async () => {
    const { clicked } = urls()
    render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'legacy.pdf', mediaType: 'application/pdf', text: 'Retained extract', originalAvailable: false } }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download extracted text' }))
    expect(clicked).toEqual(['legacy.pdf.extracted.txt'])
    expect(screen.getByText(/original upload was not archived/)).toBeInTheDocument()
  })
  it('shows extraction absence without inventing file text', async () => {
    urls()
    render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'scan.png', mediaType: 'image/png', text: '', contentBase64: btoa('TEST image bytes'), originalAvailable: true } }} />)
    expect(screen.getByText(/No extracted text is available/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download original file' })).toBeInTheDocument()
  })
  it('removes the download when access becomes denied', async () => {
    const { create } = urls()
    const view = render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'test.md', mediaType: 'text/plain', text: 'TEST content', originalAvailable: false } }} />)
    expect(screen.getByRole('button', { name: 'Download extracted text' })).toBeInTheDocument()
    view.rerender(<SectorFilePreview resource={{ status: 'denied', refresh: vi.fn() }} />)
    expect(create).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Download extracted text' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
