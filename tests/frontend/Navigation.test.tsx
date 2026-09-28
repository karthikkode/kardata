import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
    expect(
      screen.getByRole('button', { name: 'Emails (coming soon)' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('plays the chat dock exit before unmounting', () => {
    vi.useFakeTimers()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    const dock = screen.getByRole('complementary', { name: 'Assistant chat' })
    expect(dock).toBeInTheDocument()
    fireEvent.click(within(dock).getByRole('button', { name: 'Close chat' }))
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

  it('toggles the dark theme class on the document', () => {
    render(<App />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
