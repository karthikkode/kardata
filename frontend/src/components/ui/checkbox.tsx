// Owned checkbox over Base UI: visible label stays caller-side (paired via
// Field or native label); the primitive owns the box, check affordance,
// indeterminate, error, and disabled states.
import * as React from 'react'
import { Checkbox } from '@base-ui/react/checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from 'cn'

function CheckboxRoot({ className, ...props }: React.ComponentProps<typeof Checkbox.Root>) {
  return (
    <Checkbox.Root
      data-slot="checkbox"
      className={cn(
        'size-5 shrink-0 cursor-pointer rounded-md border border-input bg-transparent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:size-3.5',
        className,
      )}
      {...props}
    >
      <Checkbox.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
        render={(props, state) => (
          <span {...props}>{state.indeterminate ? <Minus aria-hidden /> : <Check aria-hidden />}</span>
        )}
      />
    </Checkbox.Root>
  )
}

export { CheckboxRoot }
