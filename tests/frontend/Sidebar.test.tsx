// Sidebar proofs: sliding active indicator, Researches owning the sector
// views, persisted collapse, and the disabled Emails entry with its Soon
// badge and explainer tooltip.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar, SIDEBAR_STORAGE_KEY } from '@/components/Sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderSidebar(active = 'Overview', onSelect: (item: string) => void = () => {}) {
  return render(
    <TooltipProvider delay={0}>
      <Sidebar active={active} onSelect={onSelect} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('Sidebar', () => {
  it('selects enabled items and marks the active one with the sliding indicator', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const { rerender } = renderSidebar('Overview', onSelect)
    const overview = screen.getByRole('button', { name: 'Overview' })
    expect(overview).toHaveAttribute('aria-current', 'page')
    expect(overview.querySelector('[data-slot="nav-indicator"]')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="nav-indicator"]')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Agents' }))
    expect(onSelect).toHaveBeenCalledWith('Agents')
    rerender(
      <TooltipProvider delay={0}>
        <Sidebar active="Agents" onSelect={onSelect} />
      </TooltipProvider>,
    )
    // The single indicator moved with the active item.
    expect(document.querySelectorAll('[data-slot="nav-indicator"]')).toHaveLength(1)
    const agents = screen.getByRole('button', { name: 'Agents' })
    expect(agents.querySelector('[data-slot="nav-indicator"]')).toBeInTheDocument()
  })

  it('treats sector views as Researches', () => {
    renderSidebar('SectorDetail')
    expect(screen.getByRole('button', { name: 'Researches' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps Emails disabled with a Soon badge and an explainer tooltip', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    renderSidebar('Overview', onSelect)
    const emails = screen.getByRole('button', { name: 'Emails (coming soon)' })
    expect(emails).toHaveAttribute('aria-disabled', 'true')
    expect(within(emails).getByText('Soon')).toBeInTheDocument()
    await user.hover(emails)
    expect(await screen.findByRole('tooltip', { name: 'Email tracking is coming soon' })).toBeInTheDocument()
    await user.unhover(emails)
    await user.click(emails)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('collapses to an icon rail, persists, and restores on reload', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSidebar()
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('expanded')
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed')
    unmount()
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('exposes collapsed destinations through tooltips', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed')
    renderSidebar()
    await user.hover(screen.getByRole('button', { name: 'Models' }))
    expect(await screen.findByRole('tooltip', { name: 'Models' })).toBeInTheDocument()
  })
})
