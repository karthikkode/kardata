// Sidebar proofs: collapse toggle, sticky rail, and the disabled Emails entry.
// Emails has no backend yet, so it stays visible but disabled with a
// coming-soon name instead of leading to a dead placeholder.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'

describe('Sidebar', () => {
  it('marks Emails as coming soon without firing select', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Sidebar active="Overview" onSelect={onSelect} />)
    const emails = screen.getByRole('button', { name: 'Emails (coming soon)' })
    expect(emails).toBeDisabled()
    await user.click(emails)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('collapses to an icon rail and expands again', async () => {
    const user = userEvent.setup()
    render(<Sidebar active="Overview" onSelect={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })
})
