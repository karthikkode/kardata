import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { List, ListRow, listRowClassName, tableRowClassName } from '@/components/ui/list'

describe('List and ListRow (plan 2.5.1)', () => {
  it('renders rows as links, buttons, or plain blocks by props', () => {
    render(
      <List>
        <ListRow href="/sectors/1">Sector one</ListRow>
        <ListRow onClick={() => undefined}>Action row</ListRow>
        <ListRow>Plain row</ListRow>
      </List>,
    )
    expect(screen.getByRole('link', { name: 'Sector one' })).toHaveAttribute('href', '/sectors/1')
    expect(screen.getByRole('button', { name: 'Action row' })).toBeInTheDocument()
    expect(screen.getByText('Plain row').tagName).toBe('DIV')
    for (const row of screen.getAllByText(/Sector one|Action row|Plain row/)) {
      expect(row.closest('[data-list-row]')).not.toBeNull()
    }
  })

  it('marks selection for the divider-hiding selectors', () => {
    render(
      <List>
        <ListRow onClick={() => undefined} selected>Selected</ListRow>
      </List>,
    )
    expect(screen.getByRole('button', { name: 'Selected' })).toHaveAttribute('data-selected', 'true')
  })

  it('sizes densities to the row-height scale', () => {
    expect(listRowClassName({ density: 'dense' })).toContain('min-h-9')
    expect(listRowClassName({ density: 'dense' })).toContain('pointer-coarse:min-h-10')
    expect(listRowClassName({ density: 'default' })).toContain('min-h-11')
    expect(listRowClassName({ density: 'comfortable' })).toContain('min-h-14')
  })

  it('keeps the hover recipe rounded, inset-padded, and ringed', () => {
    const recipe = listRowClassName()
    expect(recipe).toContain('rounded-md')
    expect(recipe).toContain('px-2')
    expect(recipe).toContain('hover:bg-surface-hover')
    expect(recipe).toContain('focus-visible:-outline-offset-2')
    expect(recipe).toContain('cursor-pointer')
    expect(listRowClassName({ interactive: false })).not.toContain('cursor-pointer')
  })

  it('renders selection as an elevated card', () => {
    const recipe = listRowClassName()
    expect(recipe).toContain('data-[selected]:bg-surface-raised')
    expect(recipe).toContain('data-[selected]:border-border-strong')
    expect(recipe).toContain('data-[selected]:shadow-sm')
  })

  it('shares the recipe with table rows', () => {
    const recipe = tableRowClassName({})
    expect(recipe).toContain('rounded-md')
    expect(recipe).toContain('hover:bg-surface-hover')
    expect(recipe).toContain('cursor-pointer')
    expect(tableRowClassName({ selected: true })).toContain('bg-surface-raised')
    expect(tableRowClassName({ selected: true })).toContain('border-border-strong')
  })

  it('activates button rows on click', async () => {
    const onClick = vi.fn()
    const { container } = render(
      <List>
        <ListRow onClick={onClick}>Clickable</ListRow>
      </List>,
    )
    container.querySelector('button')?.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('passes target and rel to link rows for external sources', () => {
    render(
      <List>
        <ListRow href="https://example.com/roster" target="_blank" rel="noopener noreferrer">Roster</ListRow>
      </List>,
    )
    const link = screen.getByRole('link', { name: 'Roster' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
