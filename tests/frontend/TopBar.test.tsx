import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from '@/components/TopBar'

describe('TopBar', () => {
  it('toggles the theme from an icon button, not text', async () => {
    const onTheme = vi.fn()
    const user = userEvent.setup()
    render(
      <TopBar query="" onQuery={() => {}} dark={false} onTheme={onTheme} chatOpen={false} onChatToggle={() => {}} showSearch />,
    )
    const toggle = screen.getByRole('button', { name: 'Switch to dark theme' })
    expect(toggle.textContent).toBe('')
    await user.click(toggle)
    expect(onTheme).toHaveBeenCalledTimes(1)
  })

  it('names the opposite theme when dark', () => {
    render(
      <TopBar query="" onQuery={() => {}} dark onTheme={() => {}} chatOpen={false} onChatToggle={() => {}} showSearch />,
    )
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    ).toBeInTheDocument()
  })

  it('reports search text through onQuery', async () => {
    const seen: string[] = []
    function SearchHarness() {
      const [query, setQuery] = useState('')
      return (
        <TopBar
          query={query}
          onQuery={(value) => { seen.push(value); setQuery(value) }}
          dark={false}
          onTheme={() => {}}
          chatOpen={false}
          onChatToggle={() => {}}
          showSearch
        />
      )
    }
    const user = userEvent.setup()
    render(<SearchHarness />)
    await user.type(screen.getByLabelText('Search researches'), 'pets')
    expect(seen).toEqual(['p', 'pe', 'pet', 'pets'])
    expect(screen.getByLabelText('Search researches')).toHaveValue('pets')
  })

  it('toggles the chat dock with an accessible name', async () => {
    const onChatToggle = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <TopBar query="" onQuery={() => {}} dark={false} onTheme={() => {}} chatOpen={false} onChatToggle={onChatToggle} showSearch />,
    )
    await user.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(onChatToggle).toHaveBeenCalledTimes(1)
    rerender(
      <TopBar query="" onQuery={() => {}} dark={false} onTheme={() => {}} chatOpen onChatToggle={onChatToggle} showSearch />,
    )
    expect(screen.getByRole('button', { name: 'Close chat' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('clears the search from a keyboard-reachable button', async () => {
    const onQuery = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <TopBar query="pets" onQuery={onQuery} dark={false} onTheme={() => {}} chatOpen={false} onChatToggle={() => {}} showSearch />,
    )
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onQuery).toHaveBeenCalledWith('')
    rerender(
      <TopBar query="" onQuery={onQuery} dark={false} onTheme={() => {}} chatOpen={false} onChatToggle={() => {}} showSearch />,
    )
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('hides the search outside Overview without losing the query', () => {
    const { rerender } = render(
      <TopBar query="pets" onQuery={() => {}} dark={false} onTheme={() => {}} chatOpen={false} onChatToggle={() => {}} showSearch={false} />,
    )
    expect(screen.queryByLabelText('Search researches')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
    rerender(
      <TopBar query="pets" onQuery={() => {}} dark={false} onTheme={() => {}} chatOpen={false} onChatToggle={() => {}} showSearch />,
    )
    expect(screen.getByLabelText('Search researches')).toHaveValue('pets')
  })
})
