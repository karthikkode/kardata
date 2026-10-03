import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LifecycleButton, type ResearchActions } from '@/components/SectorWorkspace'

function actions(overrides: Partial<ResearchActions> = {}): ResearchActions {
  return {
    busy: false,
    error: null,
    plan: vi.fn(),
    approve: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    edit: vi.fn(async () => true),
    ...overrides,
  }
}

describe('LifecycleButton', () => {
  it.each([
    ['draft', 'Create plan'],
    ['failed', 'Create plan'],
    ['planned', 'Review plan'],
    ['approved', 'Start research'],
    ['running', 'Pause'],
    ['paused', 'Resume'],
  ] as const)('labels %s sessions "%s"', (state, label) => {
    render(<LifecycleButton state={state} actions={actions()} onReviewPlan={vi.fn()} />)
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it('routes each label to its action', () => {
    const steps = actions()
    const review = vi.fn()
    const { rerender } = render(<LifecycleButton state="draft" actions={steps} onReviewPlan={review} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }))
    expect(steps.plan).toHaveBeenCalledTimes(1)
    rerender(<LifecycleButton state="planned" actions={steps} onReviewPlan={review} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review plan' }))
    expect(review).toHaveBeenCalledTimes(1)
    rerender(<LifecycleButton state="approved" actions={steps} onReviewPlan={review} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start research' }))
    expect(steps.start).toHaveBeenCalledTimes(1)
    rerender(<LifecycleButton state="running" actions={steps} onReviewPlan={review} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(steps.pause).toHaveBeenCalledTimes(1)
    rerender(<LifecycleButton state="paused" actions={steps} onReviewPlan={review} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(steps.resume).toHaveBeenCalledTimes(1)
  })

  it('keeps the label and disables while a research mutation is busy', () => {
    render(<LifecycleButton state="running" actions={actions({ busy: true })} onReviewPlan={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Pause' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('renders nothing for planning, queued and complete', () => {
    for (const state of ['planning', 'queued', 'complete'] as const) {
      const { container, unmount } = render(
        <LifecycleButton state={state} actions={actions()} onReviewPlan={vi.fn()} />,
      )
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })
})
