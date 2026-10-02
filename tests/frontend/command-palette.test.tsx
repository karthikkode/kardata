import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette } from '@/components/CommandPalette'

const SECTORS = [
  { id: 's1', name: 'Australian electrical contractors', topic: 'trades' },
  { id: 's2', name: 'Sydney plumbing services', topic: 'trades' },
]

function setup(open = true) {
  const handlers = {
    onOpenChange: vi.fn(),
    onNavigate: vi.fn(),
    onSelectSector: vi.fn(),
    onNewSector: vi.fn(),
    onOpenKarbot: vi.fn(),
    onToggleTheme: vi.fn(),
  }
  render(<CommandPalette open={open} sectors={SECTORS} {...handlers} />)
  return handlers
}

describe('command palette (F9)', () => {
  it('stays unmounted while closed', () => {
    setup(false)
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('groups navigate, sector, and action items when open', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Australian electrical contractors' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'New sector' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Open Karbot' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Toggle theme' })).toBeInTheDocument()
  })

  it('toggles on Ctrl+K and closes on Escape', async () => {
    const user = userEvent.setup()
    const handlers = setup()
    await user.keyboard('{Control>}k{/Control}')
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(handlers.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('filters sectors by name and topic', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByPlaceholderText('Search commands and sectors...'), 'plumbing')
    expect(screen.getByRole('option', { name: 'Sydney plumbing services' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Australian electrical contractors' })).not.toBeInTheDocument()
  })

  it('admits no matches honestly', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByPlaceholderText('Search commands and sectors...'), 'zzz-no-such-thing')
    expect(screen.getByText('No matching commands')).toBeInTheDocument()
  })

  it('runs the chosen item and closes', async () => {
    const user = userEvent.setup()
    const handlers = setup()
    await user.click(screen.getByRole('option', { name: 'New sector' }))
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false)
    expect(handlers.onNewSector).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('option', { name: 'Sydney plumbing services' }))
    expect(handlers.onSelectSector).toHaveBeenCalledWith('s2')
  })

  it('selects with the keyboard', async () => {
    const user = userEvent.setup()
    const handlers = setup()
    await user.type(screen.getByPlaceholderText('Search commands and sectors...'), 'Toggle theme')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(handlers.onToggleTheme).toHaveBeenCalledTimes(1))
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false)
  })
})
