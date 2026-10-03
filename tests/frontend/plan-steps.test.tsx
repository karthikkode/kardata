import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanSteps, PlanTimelineSkeleton } from '@/components/plan/PlanSteps'
import { Icons } from '@/lib/icons'

describe('PlanSteps timeline', () => {
  it('draws one rail segment between steps and none past the last', () => {
    const { container } = render(
      <PlanSteps
        steps={[
          { id: 'a', title: 'First', stepNumber: 1 },
          { id: 'b', title: 'Second', stepNumber: 2 },
          { id: 'c', title: 'Third', stepNumber: 3 },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-plan-rail]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-plan-medallion]')).toHaveLength(3)
    expect(container.querySelector('[data-plan-step="c"] [data-plan-rail]')).toBeNull()
  })

  it('renders titles, meta, numbers and bodies', () => {
    render(
      <PlanSteps
        steps={[
          { id: 'a', title: 'Licensed crews', meta: '4 queries · 5 pages each', stepNumber: 1, body: <p>Step body</p> },
        ]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Licensed crews' })).toBeInTheDocument()
    expect(screen.getByText('4 queries · 5 pages each')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Step body')).toBeInTheDocument()
  })

  it('marks success steps with a check and running steps with a pulse ring', () => {
    const { container } = render(
      <PlanSteps
        steps={[
          { id: 'done', title: 'Done', stepNumber: 1, tone: 'success' },
          { id: 'live', title: 'Live', icon: Icons.search, tone: 'running' },
          { id: 'todo', title: 'Todo', stepNumber: 3 },
        ]}
      />,
    )
    const done = container.querySelector('[data-plan-step="done"] [data-plan-medallion]')!
    const live = container.querySelector('[data-plan-step="live"] [data-plan-medallion]')!
    const todo = container.querySelector('[data-plan-step="todo"] [data-plan-medallion]')!
    expect(done.className).toContain('bg-success-soft')
    expect(done.querySelector('svg')).not.toBeNull()
    expect(live.className).toContain('bg-primary-soft')
    expect(live.querySelector('.motion-safe\\:animate-ping')).not.toBeNull()
    expect(todo.className).toContain('bg-primary-soft')
  })
})

describe('PlanTimelineSkeleton', () => {
  it('announces loading with medallion-shaped bars', () => {
    const { container } = render(<PlanTimelineSkeleton steps={3} />)
    expect(screen.getByRole('status', { name: 'Plan is loading' })).toBeInTheDocument()
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(3)
  })
})
