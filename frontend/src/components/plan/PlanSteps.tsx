// Plan timeline (PL-03/PL-04): the shared vertical stepper for
// executable plan work and narrative brief sections. Each step is an
// opaque 32px medallion on a segmented rail: the connector is a separate
// span per step running from the bottom of its medallion to the top of
// the next one, so the rail never crosses a medallion and stops at the
// last step. Medallions carry a card-coloured ring that hides the rail
// joint. Steps stagger in on first mount only (CSS mount animation, so
// polls never replay it).
import type { ReactNode } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { rowEnter, staggerDelay } from '@/lib/motion'
import { CardTitle, Caption, Numeric } from '../text'
import { Skeleton } from '../ui/skeleton'

export type PlanStepTone = 'default' | 'success' | 'running'

export interface PlanStep {
  id: string
  title: string
  /** Right-aligned caption, e.g. "4 queries · 5 pages each". */
  meta?: string
  body?: ReactNode
  /** Step glyph; falls back to `stepNumber`, then nothing. */
  icon?: typeof Icons.target
  stepNumber?: number
  tone?: PlanStepTone
}

const medallionTone: Record<PlanStepTone, string> = {
  default: 'bg-primary-soft text-primary-text',
  success: 'bg-success-soft text-success',
  running: 'bg-primary-soft text-primary-text',
}

export function PlanSteps({ steps, label = 'Plan steps' }: { steps: PlanStep[]; label?: string }) {
  return (
    <ol aria-label={label} className="flex min-w-0 flex-col">
      {steps.map((step, index) => {
        const tone = step.tone ?? 'default'
        const last = index === steps.length - 1
        const StepIcon = tone === 'success' && !step.icon ? Icons.approve : step.icon
        return (
          <li
            key={step.id}
            data-plan-step={step.id}
            style={{ animationDelay: `${staggerDelay(index)}s` }}
            className={cn('relative min-w-0 pl-12 [animation-fill-mode:backwards]', !last && 'pb-6', rowEnter)}
          >
            {last ? null : (
              <span aria-hidden data-plan-rail className="absolute top-8 bottom-0 left-4 w-0.5 -translate-x-1/2 bg-border" />
            )}
            <span aria-hidden data-plan-medallion className={cn('absolute top-0 left-0 flex size-8 items-center justify-center rounded-full ring-4 ring-card', medallionTone[tone])}>
              {tone === 'running' ? (
                <span aria-hidden className="absolute inset-0 rounded-full bg-primary opacity-30 motion-safe:animate-ping motion-safe:[animation-duration:1.6s]" />
              ) : null}
              {StepIcon ? (
                <StepIcon aria-hidden className="size-4" />
              ) : step.stepNumber !== undefined ? (
                <Numeric className="text-ui font-medium">{step.stepNumber}</Numeric>
              ) : null}
            </span>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <CardTitle className="min-w-0 flex-1 [overflow-wrap:anywhere]">{step.title}</CardTitle>
              {step.meta ? (
                <Caption className="shrink-0 tabular-nums">{step.meta}</Caption>
              ) : null}
            </div>
            {step.body ? <div className="mt-2 min-w-0">{step.body}</div> : null}
          </li>
        )
      })}
    </ol>
  )
}

/** Planning skeleton (PL-05): medallions plus title/body bars. */
export function PlanTimelineSkeleton({ steps = 4 }: { steps?: number }) {
  return (
    <div role="status" aria-label="Plan is loading" className="flex min-w-0 flex-col">
      <span className="sr-only">Loading plan</span>
      <div aria-hidden className="flex min-w-0 flex-col">
        {[0, 1, 2, 3, 4, 5].slice(0, steps).map((index, position, all) => (
          <div key={index} className={cn('relative min-w-0 pl-12', position < all.length - 1 && 'pb-6')}>
            {position < all.length - 1 ? (
              <span className="absolute top-8 bottom-0 left-4 w-0.5 -translate-x-1/2 bg-border" />
            ) : null}
            <Skeleton className="absolute top-0 left-0 size-8 rounded-full" />
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="mt-2 h-3 w-full max-w-md" />
            <Skeleton className="mt-1.5 h-3 w-2/3 max-w-sm" />
          </div>
        ))}
      </div>
    </div>
  )
}
