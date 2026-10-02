// Shared multiline styling: the textarea twin of ui/input. Bounded composer
// growth is caller-owned (max-height); this primitive owns the rest state,
// disabled, and invalid styling plus label connection via native props.
import * as React from 'react'
import { cn } from 'cn'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
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
          'field-sizing-content min-h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80',
          className,
        )}
        {...props}
      />
    )
  },
)

export { Textarea }
