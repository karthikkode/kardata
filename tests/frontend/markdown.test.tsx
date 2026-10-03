// House markdown proofs: agent replies render GFM as rich text while
// untrusted model output stays inert (no HTML, no javascript: links).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { Markdown } from '@/components/Markdown'
// NOTE: plan-icon suite appended at file end; shared import above covers it.

vi.mock('sonner', () => {
  const toastFn = vi.fn()
  return { toast: Object.assign(toastFn, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }
})

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

  it('renders chat headings at panel scale with semibold emphasis', () => {
    const { container } = render(<Markdown text={'# Title\n\n## Section\n\n### Detail\n\n**bold** and plain'} />)
    for (const level of ['h1', 'h2']) {
      const heading = container.querySelector(level) as HTMLElement
      expect(heading.className).toContain('text-[15px]')
      expect(heading.className).toContain('font-medium')
    }
    const h3 = container.querySelector('h3') as HTMLElement
    expect(h3.className).toContain('font-medium')
    expect(container.querySelector('strong')?.className).toContain('font-semibold')
    expect(container.querySelector('[data-markdown]')).not.toBeNull()
  })

  it('copies fenced code blocks and confirms with a toast', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      render(<Markdown text={'```text\nsite:parramatta crew\n```'} />)
      await user.click(screen.getByRole('button', { name: 'Copy code' }))
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('site:parramatta crew'))
      expect(toast.success).toHaveBeenCalledWith('Copied', expect.anything())
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('tolerates truncated streaming fragments', () => {
    const { container } = render(<Markdown text={'**half bold\n\n| A | B |\n|---|---|\n| 1 '} />)
    expect(container.textContent).toContain('half bold')
    const fenced = render(<Markdown text={'```ts\nconst a = 1'} />).container
    expect(fenced.textContent).toContain('const a = 1')
  })
})

describe('plan section icons', () => {
  it('matches known plan headings to glyphs and leaves the rest plain', async () => {
    const { Markdown } = await import('@/components/Markdown')
    const { container, rerender } = render(<Markdown variant="plan" text={'### scope\n\nBody'} />)
    expect(container.querySelector('h3 svg')).not.toBeNull()
    expect(screen.getByText('scope')).toBeInTheDocument()
    rerender(<Markdown variant="plan" text={'### Something custom\n\nBody'} />)
    expect(container.querySelector('h3 svg')).toBeNull()
    expect(screen.getByText('Something custom')).toBeInTheDocument()
  })

  it('keeps keyword icons out of ordinary chat markdown', async () => {
    const { Markdown } = await import('@/components/Markdown')
    const { container } = render(<Markdown text={'### scope\n\nBody'} />)
    expect(container.querySelector('h3 svg')).toBeNull()
    expect(screen.getByText('scope')).toBeInTheDocument()
  })

  it('groups plan sections with dividers on the renderer, not wrapper DOM', async () => {
    const { Markdown } = await import('@/components/Markdown')
    const { container } = render(
      <Markdown variant="plan" text={'### scope\n\nBody one\n\n### budgets\n\nBody two'} />,
    )
    const headings = Array.from(container.querySelectorAll('h3'))
    expect(headings).toHaveLength(2)
    for (const heading of headings) expect(heading.className).toContain('border-t')
    expect(container.querySelector('.plan-brief')).toBeNull()
  })

  it('gives plan h2 sections the same glyph treatment as h3', async () => {
    const { Markdown } = await import('@/components/Markdown')
    const { container } = render(<Markdown variant="plan" text={'## query shapes\n\nBody'} />)
    expect(container.querySelector('h2 svg')).not.toBeNull()
    const chat = render(<Markdown text={'## query shapes\n\nBody'} />).container
    expect(chat.querySelector('h2 svg')).toBeNull()
  })
})
