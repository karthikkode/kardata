// Shared multiline styling: the textarea twin of ui/input. Bounded composer
// growth is caller-owned (max-height); this primitive owns the rest state,
// disabled, and invalid styling plus label connection via native props.
import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusRingInput } from '@/lib/interaction'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        data-slot="textarea"
        aria-invalid={invalid || props['aria-invalid']}
        className={cn(
          `min-h-10 w-full min-w-0 rounded-md border border-input bg-surface-sunken px-3 py-2 text-base transition-colors duration-120 ease-out-soft ${focusRingInput} placeholder:text-foreground-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm`,
          className,
        )}
        {...props}
      />
    )
  },
)

export { Textarea }
