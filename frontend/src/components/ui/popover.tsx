// Non-modal anchored surface over Base UI: collision-aware positioning
// with correct trigger/content relationships owned by the primitive. One
// expanded option list or card per trigger.
import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

function PopoverRoot(props: React.ComponentProps<typeof Popover.Root>) {
  return <Popover.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ className, ...props }: React.ComponentProps<typeof Popover.Trigger>) {
  return <Popover.Trigger data-slot="popover-trigger" className={className} {...props} />
}

function PopoverPopup({ className, children, ...props }: React.ComponentProps<typeof Popover.Popup>) {
  return (
    <Popover.Portal data-slot="popover-portal">
      <Popover.Positioner data-slot="popover-positioner" sideOffset={4} className="z-50 outline-none">
        <Popover.Popup
          data-slot="popover-popup"
          className={cn(
            'w-72 origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-4 shadow-md outline-none transition-all duration-120 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<typeof Popover.Title>) {
  return (
    <Popover.Title
      data-slot="popover-title"
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  )
}

function PopoverDescription({ className, ...props }: React.ComponentProps<typeof Popover.Description>) {
  return (
    <Popover.Description
      data-slot="popover-description"
      className={cn('mt-1 text-ui text-muted-foreground', className)}
      {...props}
    />
  )
}

function PopoverClose({ className, ...props }: React.ComponentProps<typeof Popover.Close>) {
  return <Popover.Close data-slot="popover-close" className={className} {...props} />
}

export { PopoverRoot, PopoverTrigger, PopoverPopup, PopoverTitle, PopoverDescription, PopoverClose }
