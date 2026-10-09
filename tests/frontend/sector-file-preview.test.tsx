import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { SectorFilePreview } from '@/components/SectorFilePreview'

const NativeUrl = URL
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function urls() {
  const create = vi.fn(() => 'blob:test-file'), revoke = vi.fn()
  const clicked: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download) })
  vi.stubGlobal('URL', class extends NativeUrl { static createObjectURL = create; static revokeObjectURL = revoke })
  return { create, revoke, clicked }
}

describe('sector file preview and downloads', () => {
  it('renders extracted content and provides the retained original download', async () => {
    const user = userEvent.setup()
    const { create, revoke, clicked } = urls()
    const view = render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'test.md', mediaType: 'text/markdown', text: '# TEST evidence', contentBase64: btoa('# TEST evidence'), originalAvailable: true } }} />)
    expect(screen.getByRole('heading', { name: 'TEST evidence' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Original file' }))
    expect(clicked).toEqual(['test.md'])
    expect(create).toHaveBeenCalledOnce()
    view.unmount()
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:test-file'))
  })
  it('labels extracted-only legacy downloads honestly', async () => {
    const user = userEvent.setup()
    const { clicked } = urls()
    render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'legacy.pdf', mediaType: 'application/pdf', text: 'Retained extract', originalAvailable: false } }} />)
    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('menuitem', { name: 'Original file' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(await screen.findByRole('menuitem', { name: 'Extracted text' }))
    expect(clicked).toEqual(['legacy.pdf.extracted.txt'])
    expect(screen.getByText(/original upload was not archived/)).toBeInTheDocument()
  })
  it('shows extraction absence without inventing file text', async () => {
    const user = userEvent.setup()
    const { clicked } = urls()
    render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'scan.png', mediaType: 'image/png', text: '', contentBase64: btoa('TEST image bytes'), originalAvailable: true } }} />)
    expect(screen.getByRole('heading', { name: 'No extracted text' })).toBeInTheDocument()
    const downloads = screen.getAllByRole('button', { name: 'Download' })
    expect(downloads).toHaveLength(2)
    await user.click(downloads[1]!)
    expect(clicked).toEqual(['scan.png'])
  })
  it('removes the download when access becomes denied', async () => {
    const { create } = urls()
    const view = render(<SectorFilePreview resource={{ status: 'ready', refresh: vi.fn(), data: { filename: 'test.md', mediaType: 'text/plain', text: 'TEST content', originalAvailable: false } }} />)
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    view.rerender(<SectorFilePreview resource={{ status: 'denied', refresh: vi.fn() }} />)
    expect(create).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
