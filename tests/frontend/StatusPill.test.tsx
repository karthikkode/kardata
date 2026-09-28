import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatusPill, type StatusTone } from '@/components/StatusPill'

const tones: StatusTone[] = ['ok', 'working', 'paused', 'failed', 'idle']

describe('StatusPill', () => {
  it('shows the given label as visible text', () => {
    render(<StatusPill tone="working" label="Researching now" />)
    expect(screen.getByText('Researching now')).toBeInTheDocument()
  })

  it.each(tones)('marks the %s tone on its dot', (tone) => {
    const { container } = render(<StatusPill tone={tone} label="State" />)
    expect(container.querySelector('[data-tone]')).toHaveAttribute(
      'data-tone',
      tone,
    )
  })

  it('hides the decorative dot from assistive tech', () => {
    render(<StatusPill tone="ok" label="Finished" />)
    const pill = screen.getByText('Finished').closest('span')!
    expect(pill.textContent).toBe('Finished')
  })

  it('renders a plain span with default cursor when not clickable', () => {
    render(<StatusPill tone="idle" label="Queued" />)
    const pill = screen.getByText('Queued')
    expect(pill.closest('button')).toBeNull()
    const root = pill.parentElement!
    expect(root).not.toHaveClass('cursor-pointer')
    expect(root).toHaveClass('select-none')
  })

  it('renders a button with pointer cursor and fires on click', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<StatusPill tone="paused" label="Paused" onClick={onClick} />)
    const pill = screen.getByRole('button', { name: 'Paused' })
    expect(pill).toHaveClass('cursor-pointer', 'hover:shadow-md')
    await user.click(pill)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
