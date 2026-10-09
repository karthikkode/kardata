// Owned switch over Base UI: only for genuine boolean settings. Never use
// for approval acknowledgment (that stays an explicit button/checkbox).
import * as React from 'react'
import { Switch } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/interaction'

function SwitchRoot({ className, ...props }: React.ComponentProps<typeof Switch.Root>) {
  return (
    <Switch.Root
      data-slot="switch"
      className={cn(
        `h-6 w-10 shrink-0 cursor-pointer rounded-full border border-input bg-surface-active p-0.5 transition-colors duration-120 ease-out-soft ${focusRing} disabled:pointer-events-none disabled:opacity-50 data-checked:border-primary data-checked:bg-primary`,
        className,
      )}
      {...props}
    >
      <Switch.Thumb
        data-slot="switch-thumb"
        className="block size-[18px] rounded-full bg-foreground transition-transform duration-120 ease-out-soft data-checked:translate-x-4 data-checked:bg-primary-foreground"
      />
    </Switch.Root>
  )
}

export { SwitchRoot }
