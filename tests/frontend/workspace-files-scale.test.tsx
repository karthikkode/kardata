import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { WorkspaceFiles } from '@/components/workspace-parts'
import type { LibraryFile } from '@/data/workspace-api'

const data: LibraryFile[] = Array.from({ length: 2005 }, (_, index) => ({ id: `TEST file ${index}`, filename: `TEST source ${index}.md`, status: index === 1 ? 'processing' : index === 2 ? 'failed' : index === 3 ? 'needs-ocr' : 'indexed', source: index % 2 ? 'Uploaded' : 'Research agent', hash: `TEST ${index}`, hidden: index === 4, included: false, kind: index % 2 ? 'document' : 'artifact' }))
const props = { resource: { status: 'ready' as const, refresh: vi.fn(), data }, busy: false, onUpload: vi.fn(), onHide: vi.fn(), onInclude: vi.fn(), onPreview: vi.fn() }

it('keeps a large library in fifty-row windows without hiding indexed/error states or totals', async () => {
  const user = userEvent.setup()
  render(<WorkspaceFiles {...props} />)
  expect(screen.getAllByRole('button', { name: /^TEST source/ })).toHaveLength(50)
  expect(screen.getByText('Showing 50 of 2,004 files')).toBeInTheDocument()
  expect(screen.getByText('2,004 files')).toBeInTheDocument()
  for (const state of ['Processing', 'Failed', 'Needs OCR']) expect(screen.getByText(state, { exact: true })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Show more' }))
  expect(screen.getAllByRole('button', { name: /^TEST source/ })).toHaveLength(100)
  expect(screen.getByText('Showing 100 of 2,004 files')).toBeInTheDocument()
  // Single change events, not keystroke typing: 11 keystrokes x a
  // 2005-row filter render overruns vitest's 5s timeout under full-suite
  // worker contention. The filter reads onChange, so this stays faithful.
  fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), { target: { value: 'source 2004' } })
  expect(screen.getByRole('button', { name: 'TEST source 2004.md' })).toBeInTheDocument()
  expect(screen.getByText('Showing 1 of 1 files')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), { target: { value: '' } })
  expect(screen.getAllByRole('button', { name: /^TEST source/ })).toHaveLength(50)
})

it('resets the window on hidden-file filtering and keeps reveal/preview authority intact', async () => {
  const user = userEvent.setup()
  render(<WorkspaceFiles {...props} />)
  await user.click(screen.getByRole('button', { name: 'Show more' }))
  await user.click(screen.getByRole('button', { name: 'Show hidden files' }))
  expect(screen.getAllByRole('button', { name: /^TEST source/ })).toHaveLength(50)
  expect(screen.getByText('Showing 50 of 2,005 files')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'TEST source 4.md' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Reveal TEST source 4.md to agents' }))
  expect(props.onHide).toHaveBeenCalledWith('TEST file 4', false)
})

it('preserves an expanded window when the metadata library refreshes', async () => {
  const user = userEvent.setup()
  const view = render(<WorkspaceFiles {...props} />)
  await user.click(screen.getByRole('button', { name: 'Show more' }))
  view.rerender(<WorkspaceFiles {...props} resource={{ ...props.resource, data: [...data, { ...data[0], id: 'TEST new upload', filename: 'TEST new upload.md' }] }} />)
  expect(screen.getByText('Showing 100 of 2,005 files')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^TEST source/ })).toHaveLength(100)
})

it('formats both OCR status spellings for the owner', () => {
  render(<WorkspaceFiles {...props} resource={{ ...props.resource, data: [{ ...data[0], status: 'needs_ocr' }] }} />)
  expect(screen.getByText('Needs OCR')).toBeInTheDocument()
  expect(screen.queryByText('needs_ocr')).not.toBeInTheDocument()
})
