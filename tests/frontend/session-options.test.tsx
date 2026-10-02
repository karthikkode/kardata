import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionOptions } from '@/components/SectorWorkspace'

describe('SessionOptions deletion', () => {
  it('confirms normal-session deletion through an explicit alert dialog', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <SessionOptions title="Evening chat" research={false} busy={false} onRename={() => undefined} onDelete={onDelete} />,
    )
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Delete "Evening chat"?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('offers no deletion action for research sessions', () => {
    render(
      <SessionOptions title="Research" research busy={false} onRename={() => undefined} onDelete={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save name' })).toBeInTheDocument()
  })

  it('preserves the name on failed save by keeping the draft', async () => {
    const user = userEvent.setup()
    render(
      <SessionOptions title="Evening chat" research={false} busy={false} onRename={() => undefined} onDelete={vi.fn()} />,
    )
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Renamed chat')
    expect(input).toHaveValue('Renamed chat')
  })
})
