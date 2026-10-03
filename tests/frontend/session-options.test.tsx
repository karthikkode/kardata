import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RenameSessionDialog } from '@/components/SectorWorkspace'

describe('RenameSessionDialog (SO-01)', () => {
  it('autofocuses the name field with the title selected', async () => {
    render(<RenameSessionDialog title="Evening chat" busy={false} onClose={vi.fn()} onSave={vi.fn()} />)
    const input = await screen.findByRole('textbox', { name: 'Chat name' })
    expect(input).toHaveValue('Evening chat')
    await waitFor(() => expect(input).toHaveFocus())
    expect((input as HTMLInputElement).selectionStart).toBe(0)
    expect((input as HTMLInputElement).selectionEnd).toBe('Evening chat'.length)
  })

  it('saves the trimmed name and closes on success', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => true)
    const onClose = vi.fn()
    render(<RenameSessionDialog title="Evening chat" busy={false} onClose={onClose} onSave={onSave} />)
    const input = await screen.findByRole('textbox', { name: 'Chat name' })
    await user.clear(input)
    await user.type(input, '  Morning review  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('Morning review')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft open when the save fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => false)
    const onClose = vi.fn()
    render(<RenameSessionDialog title="Evening chat" busy={false} onClose={onClose} onSave={onSave} />)
    const input = await screen.findByRole('textbox', { name: 'Chat name' })
    await user.clear(input)
    await user.type(input, 'Renamed chat')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('Renamed chat')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Chat name' })).toHaveValue('Renamed chat')
  })

  it('disables Save for a blank name and cancels without saving', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<RenameSessionDialog title="Evening chat" busy={false} onClose={onClose} onSave={onSave} />)
    const input = await screen.findByRole('textbox', { name: 'Chat name' })
    await user.clear(input)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
