import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { EXIT_MS } from '@/lib/motion'

describe('Section navigation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves focus to the new heading when switching sections', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Researches' }))
    expect(screen.getByRole('heading', { name: 'Researches' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByRole('heading', { name: 'Overview' })).toHaveFocus()
  })

  it('keeps sidebar names available to assistive tech', () => {
    render(<App />)
    for (const name of ['Overview', 'Researches', 'Agents']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    const emails = screen.getByRole('button', { name: 'Emails (coming soon)' })
    expect(emails).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(emails)
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('plays the chat dock exit before unmounting', () => {
    vi.useFakeTimers()
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask Karbot' })[0] as HTMLElement)
    const dock = screen.getByRole('complementary', { name: 'Assistant chat' })
    expect(dock).toBeInTheDocument()
    fireEvent.click(within(dock).getByRole('button', { name: 'Close' }))
    expect(
      screen.getByRole('complementary', { name: 'Assistant chat' }),
    ).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    expect(
      screen.queryByRole('complementary', { name: 'Assistant chat' }),
    ).not.toBeInTheDocument()
  })

  it('falls back to home for a removed section in the URL', () => {
    window.history.replaceState({}, '', '/?section=Settings')
    try {
      render(<App />)
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('switches themes through the theme menu', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
