// Shared research presentation (OV/RS/SL): one status badge per row,
// four-segment stage indicators with humanized labels.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StageSteps, StateBadge, stateToBadgeTone } from '@/components/research-parts'

describe('stateToBadgeTone', () => {
  it.each([
    ['draft', 'neutral'],
    ['planning', 'info'],
    ['planned', 'warning'],
    ['approved', 'info'],
    ['running', 'info'],
    ['paused', 'warning'],
    ['queued', 'neutral'],
    ['failed', 'danger'],
    ['complete', 'success'],
  ] as const)('maps %s to %s', (state, tone) => {
    expect(stateToBadgeTone(state)).toBe(tone)
  })
})

describe('StateBadge', () => {
  it('renders one subtle badge with a dot and the state label', () => {
    render(<StateBadge state="running" />)
    const badge = screen.getByText('In progress')
    expect(badge.closest('[data-slot="badge"]')).toHaveClass('bg-info-soft')
  })
})

describe('StageSteps', () => {
  it('announces the current step with a humanized label', () => {
    render(<StageSteps stage="Deep research" />)
    expect(screen.getByLabelText('Stage 2 of 4: Deep research')).toBeInTheDocument()
    expect(screen.getByTitle('Stage 2 of 4: Deep research')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTitle('Stage 1 of 4: Screening')).not.toHaveAttribute('aria-current')
  })

  it('fills segments up to the current stage', () => {
    const { container } = render(<StageSteps stage="Problem found" />)
    const segments = [...container.querySelectorAll('li')]
    expect(segments).toHaveLength(4)
    expect(segments.slice(0, 3).every((segment) => segment.className.includes('bg-primary'))).toBe(true)
    expect(segments[3].className).toContain('bg-surface-active')
  })

  it('stays honest on an unknown stage', () => {
    const { container } = render(<StageSteps stage="Mystery stage" />)
    expect(screen.getByLabelText('Stage: Mystery stage')).toBeInTheDocument()
    const segments = [...container.querySelectorAll('li')]
    expect(segments.every((segment) => segment.className.includes('bg-surface-active'))).toBe(true)
  })
})
