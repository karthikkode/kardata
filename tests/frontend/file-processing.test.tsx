import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FileProcessingStatus } from '@/components/FileProcessingStatus'
import { FileProcessingRetry } from '@/components/FileProcessingRetry'
import type { FileProcessingProgress, LibraryFile } from '@/data/workspace-api'
const progress: FileProcessingProgress = { jobId: 'TEST job', state: 'uncertain', revision: 1, totalImages: 12, completedImages: 5, failedImages: 0, uncertainImages: 1, errorCode: 'provider_outcome_unknown', retryRequiresApproval: true }
const file: LibraryFile = { id: 'TEST file', filename: 'TEST mixed PDF.pdf', status: 'failed', source: 'upload', hash: 'TEST version', hidden: false, included: false, kind: 'document', processing: progress }
for (const state of ['queued','paused','failed','uncertain','complete'] as const) it(`shows ${state} from durable file status with honest image counts`, () => {
  render(<FileProcessingStatus progress={{ ...progress, state }} hidden={false} busy={false} onRetry={vi.fn()} />)
  expect(screen.getByRole('status')).toBeVisible()
  expect(screen.getByText(/5 of 12 image analyses saved/)).toBeVisible()
  expect(screen.queryByText(/100%/)).not.toBeInTheDocument()
})
it('shows processing with the live image count instead of a saved total', () => {
  render(<FileProcessingStatus progress={{ ...progress, state: 'processing' }} hidden={false} busy={false} onRetry={vi.fn()} />)
  expect(screen.getByRole('status')).toHaveTextContent('Analysing images 5 of 12')
  expect(screen.getByRole('progressbar', { name: 'File processing progress' })).toBeVisible()
  expect(screen.queryByText(/100%/)).not.toBeInTheDocument()
})
it('does not invent a percentage while pages are being parsed', () => {
  render(<FileProcessingStatus progress={{ ...progress, state: 'processing', totalImages: null }} hidden={false} busy={false} />)
  expect(screen.getByText('Reading PDF pages')).toBeVisible()
  expect(screen.queryByText(/of .* image analyses/)).not.toBeInTheDocument()
})
it('hides retry for hidden files and disables repeated busy actions', () => {
  const view = render(<FileProcessingStatus progress={progress} hidden busy={false} onRetry={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Review retry' })).not.toBeInTheDocument()
  view.rerender(<FileProcessingStatus progress={progress} hidden={false} busy onRetry={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Review retry' })).toBeDisabled()
})
it('requires explicit paid-risk approval and preserves the review after a failed resume', async () => {
  const retry = vi.fn(async () => false), close = vi.fn()
  render(<FileProcessingRetry file={file} latest={file} busy={false} error="TEST retry unavailable" onRetry={retry} onClose={close} />)
  const submit = screen.getByRole('button', { name: 'Resume file processing' })
  expect(submit).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(submit)
  expect(retry).toHaveBeenCalledWith('TEST job', 1, true)
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(screen.getByRole('alert')).toHaveTextContent('TEST retry unavailable')
})
it('blocks stale revisions and requires renewed paid review of the latest state', async () => {
  const latest = { ...file, processing: { ...progress, revision: 2 } }, retry = vi.fn(async () => true)
  render(<FileProcessingRetry file={file} latest={latest} busy={false} error={null} onRetry={retry} onClose={vi.fn()} />)
  await userEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'Resume file processing' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Review latest processing' }))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(screen.getByRole('button', { name: 'Resume file processing' }))
  expect(retry).toHaveBeenCalledWith('TEST job', 2, true)
})
it('permits safe pre-effect retry without a duplicate-paid acknowledgement', async () => {
  const safe = { ...file, processing: { ...progress, state: 'failed' as const, retryRequiresApproval: false } }, retry = vi.fn(async () => true), close = vi.fn()
  render(<FileProcessingRetry file={safe} latest={safe} busy={false} error={null} onRetry={retry} onClose={close} />)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Resume file processing' }))
  expect(retry).toHaveBeenCalledWith('TEST job', 1, false)
  expect(close).toHaveBeenCalledOnce()
})

it('shows bounded file previews honestly and pages indexed content without appending every section', async () => {
  const { SectorFilePreview } = await import('@/components/SectorFilePreview')
  const browse = vi.fn(), next = vi.fn(), previous = vi.fn()
  const body = { status: 'ready' as const, data: { filename: 'TEST.pdf', mediaType: 'application/pdf', text: 'TEST preview', fullChars: 90000, textTruncated: true, originalAvailable: true, contentBase64: 'VEVTVA==' }, refresh: vi.fn() }
  const view = render(<SectorFilePreview resource={body} onBrowse={browse} />)
  expect(screen.getByText(/bounded preview of 90,000 indexed characters/)).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Browse indexed sections' }))
  expect(browse).toHaveBeenCalledOnce()
  const units = { status: 'ready' as const, data: { status: 'indexed', units: [{ ord: 20, kind: 'ocr', text: 'TEST saved image description', uncertain: true, page: 3 }], nextOrd: 40, fullChars: 90000 }, refresh: vi.fn() }
  view.rerender(<SectorFilePreview resource={body} units={units} hasPrevious onNext={next} onPrevious={previous} />)
  expect(screen.getByRole('region', { name: 'Indexed section 21' })).toBeVisible()
  expect(screen.queryByText('TEST preview')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Next sections' }))
  await userEvent.click(screen.getByRole('button', { name: 'Previous sections' }))
  expect(next).toHaveBeenCalledOnce(); expect(previous).toHaveBeenCalledOnce()
})

it('requires renewed review when paid-risk changes within the same job revision', async () => {
  const originallySafe = { ...file, processing: { ...progress, retryRequiresApproval: false } }
  render(<FileProcessingRetry file={originallySafe} latest={file} busy={false} error={null} onRetry={vi.fn(async () => true)} onClose={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Resume file processing' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Review latest processing' }))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Resume file processing' })).toBeDisabled()
})
