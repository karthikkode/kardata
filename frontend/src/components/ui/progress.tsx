// Determinate progress only: render when the backend supplies a bounded
// denominator (max/value). Never invent upload percentages or completion
// from budget exhaustion.
import * as React from 'react'
import { Progress } from '@base-ui/react/progress'
import { cn } from 'cn'

function ProgressRoot({ className, ...props }: React.ComponentProps<typeof Progress.Root>) {
  return (
    <Progress.Root
      data-slot="progress"
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <Progress.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 rounded-full bg-primary transition-transform duration-150 ease-out"
      />
    </Progress.Root>
  )
}

export { ProgressRoot }
