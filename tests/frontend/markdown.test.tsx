// House markdown proofs: agent replies render GFM as rich text while
// untrusted model output stays inert (no HTML, no javascript: links).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from '@/components/Markdown'

describe('house markdown', () => {
  it('renders bold lead-ins, lists, tables, and code', () => {
    const { container } = render(
      <Markdown
        text={'**Sessions:** 0 found\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nUse `db.search` per [knowledge_base/pricing.md].'}
      />,
    )
    expect(screen.getByText('Sessions:')).toBeInTheDocument()
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('code')).not.toBeNull()
    // Citations stay literal bracket text, never links.
    expect(screen.getByText('[knowledge_base/pricing.md]', { exact: false })).toBeInTheDocument()
    expect(container.querySelector('a[href*="knowledge_base"]')).toBeNull()
  })

  it('renders agent heading levels as real headings', () => {
    render(<Markdown text={'# Title\n\n## Section'} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument()
  })

  it('renders tables with scoped headers inside their own scroll container', () => {
    const { container } = render(
      <Markdown text={'| filename | status |\n|---|---|\n| brief.md | indexed |'} />,
    )
    expect(screen.getByRole('columnheader', { name: 'filename' })).toHaveAttribute('scope', 'col')
    const table = container.querySelector('table')
    expect(table?.parentElement).toHaveClass('overflow-x-auto')
  })

  it('keeps hostile model output inert', () => {
    const { container } = render(
      <Markdown text={'<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n[ok](https://example.com)'} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    const bad = container.querySelector('a[href="#"]')
    expect(bad?.textContent).toBe('click')
    expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull()
  })

  it('tolerates truncated streaming fragments', () => {
    const { container } = render(<Markdown text={'**half bold\n\n| A | B |\n|---|---|\n| 1 '} />)
    expect(container.textContent).toContain('half bold')
    const fenced = render(<Markdown text={'```ts\nconst a = 1'} />).container
    expect(fenced.textContent).toContain('const a = 1')
  })
})
