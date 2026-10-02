// Owned tooltip over Base UI: pointer and keyboard presentation. Never the
// sole source of essential text: icon-only controls next to this must also
// carry an accessible name on the trigger itself.
import * as React from 'react'
import { Tooltip } from '@base-ui/react/tooltip'
import { cn } from 'cn'

function TooltipProvider(props: React.ComponentProps<typeof Tooltip.Provider>) {
  return <Tooltip.Provider data-slot="tooltip-provider" {...props} />
}

function TooltipRoot(props: React.ComponentProps<typeof Tooltip.Root>) {
  return <Tooltip.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ className, ...props }: React.ComponentProps<typeof Tooltip.Trigger>) {
  return <Tooltip.Trigger data-slot="tooltip-trigger" className={className} {...props} />
}

function TooltipPopup({ className, ...props }: React.ComponentProps<typeof Tooltip.Popup>) {
  return (
    <Tooltip.Portal data-slot="tooltip-portal">
      <Tooltip.Positioner data-slot="tooltip-positioner" sideOffset={6}>
        <Tooltip.Popup
          data-slot="tooltip-popup"
          role="tooltip"
          className={cn(
            'z-50 max-w-64 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg outline-none transition ease-out duration-150 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </Tooltip.Positioner>
    </Tooltip.Portal>
  )
}

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPopup }
