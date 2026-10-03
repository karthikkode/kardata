import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from '@/components/TopBar'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderBar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return render(
    <TooltipProvider delay={0}>
      <TopBar
        chatOpen={false}
        onChatToggle={() => {}}
        onOpenPalette={() => {}}
        themePreference="system"
        onThemePreference={() => {}}
        {...overrides}
      />
    </TooltipProvider>,
  )
}

describe('TopBar', () => {
  it('opens the palette from the search trigger', async () => {
    const onOpenPalette = vi.fn()
    const user = userEvent.setup()
    renderBar({ onOpenPalette })
    const trigger = screen.getByRole('button', { name: /Search\.\.\. Ctrl K/ })
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Control+k Meta+k')
    await user.click(trigger)
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it('toggles the Karbot dock with an accessible name', async () => {
    const onChatToggle = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <TooltipProvider delay={0}>
        <TopBar chatOpen={false} onChatToggle={onChatToggle} onOpenPalette={() => {}} themePreference="system" onThemePreference={() => {}} />
      </TooltipProvider>,
    )
    // Desktop and mobile variants share the name; CSS shows one at a
    // time (jsdom applies no CSS, so both are queryable here).
    const toggles = screen.getAllByRole('button', { name: 'Ask Karbot' })
    expect(toggles).toHaveLength(2)
    await user.click(toggles[0] as HTMLElement)
    expect(onChatToggle).toHaveBeenCalledTimes(1)
    rerender(
      <TooltipProvider delay={0}>
        <TopBar chatOpen onChatToggle={onChatToggle} onOpenPalette={() => {}} themePreference="system" onThemePreference={() => {}} />
      </TooltipProvider>,
    )
    for (const toggle of screen.getAllByRole('button', { name: 'Ask Karbot' })) {
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }
  })

  it('changes the theme through the theme menu', async () => {
    const onThemePreference = vi.fn()
    const user = userEvent.setup()
    renderBar({ onThemePreference })
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
    expect(onThemePreference).toHaveBeenCalledWith('dark')
  })

  it('offers no page search field', () => {
    renderBar()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})
