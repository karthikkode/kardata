// Shared loading primitives (P6.2): the Skeleton contract plus the motion
// helper math. SectorWorkspace's session-rail skeleton must be built from
// the shared primitive, never ad-hoc muted blocks.
// [F:frontend.src.components.ui.skeleton] [F:frontend.src.components.SectorWorkspace]
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionListSkeleton } from '@/components/SectorWorkspace'
import { Skeleton } from '@/components/ui/skeleton'
import { MOTION, prefersReducedMotion, staggerDelay } from '@/lib/motion'

afterEach(() => vi.unstubAllGlobals())

describe('Skeleton primitive', () => {
  it('is hidden from assistive tech and carries the sheen', () => {
    const { container } = render(<Skeleton data-testid="sk" />)
    const node = container.querySelector('[data-slot="skeleton"]')
    expect(node?.getAttribute('aria-hidden')).toBe('true')
    expect(node?.className).toContain('skeleton-sheen')
    expect(node?.className).toContain('motion-reduce:animate-none')
  })

  it('merges geometry classes and passes props through', () => {
    const { container } = render(<Skeleton className="h-3 w-1/3" style={{ width: '64%' }} />)
    const node = container.querySelector('[data-slot="skeleton"]') as HTMLElement
    expect(node.className).toContain('h-3')
    expect(node.className).toContain('w-1/3')
    expect(node.style.width).toBe('64%')
  })
})

describe('SessionListSkeleton', () => {
  it('renders five rows from the shared primitive', () => {
    const { container } = render(<SessionListSkeleton />)
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(15)
  })
})

describe('motion helpers', () => {
  it('staggers 30ms per item capped at the first 12', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(5)).toBeCloseTo(0.15)
    expect(staggerDelay(11)).toBeCloseTo(0.33)
    expect(staggerDelay(12)).toBeCloseTo(0.33)
    expect(staggerDelay(100)).toBeCloseTo(0.33)
    expect(staggerDelay(-1)).toBe(0)
  })

  it('reads the reduced-motion media query, defaulting to motion', () => {
    vi.stubGlobal('matchMedia', undefined as unknown as typeof window.matchMedia)
    expect(prefersReducedMotion()).toBe(false)
    vi.stubGlobal('matchMedia', ((query: string) => ({ matches: query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia)
    expect(prefersReducedMotion()).toBe(true)
  })

  it('keeps the documented motion scale', () => {
    expect(MOTION).toMatchObject({ fast: 120, base: 180, slow: 240 })
  })
})
