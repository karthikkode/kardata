// FilesMenu proofs over real artifact rows: indexed files list, pick
// inserts the reference, empty index explains itself. Uploads have no
// backend endpoint, so no upload row exists.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FilesMenu, type ChatFile } from '@/components/ChatPanel'

const noop = () => {}

const FILES: ChatFile[] = [
  { id: 'art-1', name: 'sources.csv', detail: '4 feeds', source: 'report' },
  { id: 'art-2', name: 'shortlist.md', detail: '3 of 14 kept', source: 'report' },
]

function renderMenu(files: ChatFile[] = FILES, onPick: (file: ChatFile) => void = noop) {
  return render(
    <FilesMenu files={files} closing={false} onPick={onPick} onClose={noop} onEscape={noop} />,
  )
}

describe('files menu', () => {
  it('lists indexed files and picks one for reference', () => {
    const onPick = vi.fn()
    renderMenu(FILES, onPick)
    expect(screen.getByText('sources.csv')).toBeInTheDocument()
    expect(screen.getByText('shortlist.md')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /sources\.csv/ }))
    expect(onPick).toHaveBeenCalledWith(FILES[0])
  })

  it('explains an empty index without an upload row', () => {
    renderMenu([])
    expect(screen.getByText('No files indexed in this session yet.')).toBeInTheDocument()
    expect(screen.queryByText('Upload from computer')).not.toBeInTheDocument()
  })

  it('dismisses on Escape', () => {
    const onEscape = vi.fn()
    render(
      <FilesMenu files={FILES} closing={false} onPick={noop} onClose={noop} onEscape={onEscape} />,
    )
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Add files' }), { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
})
