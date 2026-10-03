import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeMenu } from '@/components/ThemeMenu'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ThemePreference } from '@/lib/theme'

function Controlled({ initial = 'system' as ThemePreference, onChange = vi.fn() }: { initial?: ThemePreference; onChange?: (next: ThemePreference) => void }) {
  const [preference, setPreference] = useState<ThemePreference>(initial)
  return (
    <TooltipProvider delay={0}>
      <ThemeMenu
        preference={preference}
        onPreference={(next) => {
          setPreference(next)
          onChange(next)
        }}
      />
    </TooltipProvider>
  )
}

describe('ThemeMenu', () => {
  it('shows a tooltip and opens the menu from the trigger button', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const trigger = screen.getByRole('button', { name: 'Theme' })
    await user.hover(trigger)
    expect(await screen.findByRole('tooltip', { name: 'Theme' })).toBeInTheDocument()
    await user.click(trigger)
    expect(await screen.findByRole('menuitemradio', { name: 'System' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toBeInTheDocument()
  })

  it('marks the active preference and reports a change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled initial="light" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('dismisses the menu when a preference is selected', async () => {
    const user = userEvent.setup()
    render(<Controlled initial="light" />)
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    // The choice applied: reopening shows Dark checked.
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  })

  it('moves with arrow keys and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    const system = await screen.findByRole('menuitemradio', { name: 'System' })
    system.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})
