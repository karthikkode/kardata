// Owned popover over Base UI: portaled positioning with collision handling
// and controlled dismissal. Content never clips inside an ancestor scroll
// container (portal). Controlled callers own open/onOpenChange.
import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import { cn } from 'cn'

function PopoverRoot(props: React.ComponentProps<typeof Popover.Root>) {
  return <Popover.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ className, ...props }: React.ComponentProps<typeof Popover.Trigger>) {
  return <Popover.Trigger data-slot="popover-trigger" className={className} {...props} />
}

function PopoverPopup({ className, ...props }: React.ComponentProps<typeof Popover.Popup>) {
  return (
    <Popover.Portal data-slot="popover-portal">
      <Popover.Positioner data-slot="popover-positioner" sideOffset={8}>
        <Popover.Popup
          data-slot="popover-popup"
          className={cn(
            'z-50 w-72 rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg outline-none transition ease-out duration-150 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </Popover.Positioner>
    </Popover.Portal>
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<typeof Popover.Title>) {
  return (
    <Popover.Title
      data-slot="popover-title"
      className={cn('text-sm font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function PopoverDescription({ className, ...props }: React.ComponentProps<typeof Popover.Description>) {
  return (
    <Popover.Description
      data-slot="popover-description"
      className={cn('mt-1 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { PopoverRoot, PopoverTrigger, PopoverPopup, PopoverTitle, PopoverDescription }
