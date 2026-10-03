import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button affordance', () => {
  it('promises clickability with a pointer cursor', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      'cursor-pointer',
    )
  })
})

describe('Button scale (handoff 2.5)', () => {
  it('renders standard controls at 40px', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('h-10')
  })

  it('keeps compact controls at 32px with touch enlargement to 40px', () => {
    const { rerender } = render(<Button size="sm">More</Button>)
    expect(screen.getByRole('button', { name: 'More' })).toHaveClass('h-8', 'pointer-coarse:h-10')
    rerender(
      <Button size="icon-sm" aria-label="Close">
        X
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('size-8', 'pointer-coarse:size-10')
  })

  it('keeps standard icon buttons at 40px', () => {
    render(
      <Button size="icon" aria-label="Menu">
        M
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveClass('size-10')
  })
})
