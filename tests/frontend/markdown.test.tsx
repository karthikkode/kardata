// House markdown proofs: agent replies render GFM as rich text while
// untrusted model output stays inert (no HTML, no javascript: links).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { Markdown, isPlainChatText } from '@/components/Markdown'
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

describe('section variant', () => {
  it('renders in-section headings in the label register, never larger than the section labels', () => {
    const { container } = render(<Markdown variant="section" text={'## Coverage\n\nParramatta first.'} />)
    const heading = container.querySelector('h2')
    expect(heading).not.toBeNull()
    expect(heading!.className).toContain('text-2xs')
    expect(heading!.className).toContain('uppercase')
    expect(heading!.className).not.toContain('text-ui')
    expect(heading!.className).not.toContain('font-semibold')
  })
})

describe('plain-text fast path', () => {
  it.each([
    'Scale-A answer 1000',
    'Price is 45 AUD (inc GST).',
    'a > b, and (c) beats "d".',
    'First line\nsecond line',
    'Para one\n\nPara two',
  ])('treats %j as plain', (text) => {
    expect(isPlainChatText(text)).toBe(true)
  })

  it.each([
    '**bold**', '`code`', '# heading', '- item', '1. item', '> quote',
    '[link](https://example.com)', '![alt](img.png)', '| a | b |',
    '<b>html</b>', 'C:\\path\\file', 'a_b', 'a~~b~~',
    'see https://example.com/x', 'go to www.example.com', 'mail a@b.com',
    'x'.repeat(5001),
  ])('sends %j through remark', (text) => {
    expect(isPlainChatText(text)).toBe(false)
  })

  it('renders plain paragraphs with the same chat <p> as remark', () => {
    const { container } = render(<Markdown text={'Scale-A answer 1000\n\nSecond para'} />)
    const paras = Array.from(container.querySelectorAll('p'))
    expect(paras).toHaveLength(2)
    expect(paras[0]!.textContent).toBe('Scale-A answer 1000')
    expect(paras[0]!.className).toContain('leading-[22px]')
    expect(container.querySelector('[data-markdown]')).not.toBeNull()
  })

  it('renders plain text identically across variants', () => {
    for (const variant of ['chat', 'plan', 'compact', 'section'] as const) {
      const { container, unmount } = render(<Markdown variant={variant} text="Just words here" />)
      expect(container.querySelector('p')?.textContent).toBe('Just words here')
      unmount()
    }
  })

  it('still linkifies GFM autolinks instead of fast-pathing them', () => {
    const { container } = render(<Markdown text="see https://example.com/x for rates" />)
    expect(container.querySelector('a[href="https://example.com/x"]')).not.toBeNull()
  })
})
