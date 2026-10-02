// Owned select over Base UI: labeled finite choices with keyboard
// navigation and a portaled popup. Backend catalogue only: callers pass the
// exact items, never guessed names.
import * as React from 'react'
import { Select } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from 'cn'

function SelectRoot<T>(props: React.ComponentProps<typeof Select.Root<T>>) {
  return <Select.Root<T> data-slot="select" {...props} />
}

function SelectTrigger({ className, ...props }: React.ComponentProps<typeof Select.Trigger>) {
  return (
    <Select.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-10 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <Select.Value data-slot="select-value" className="min-w-0 flex-1 truncate text-left" />
      <Select.Icon data-slot="select-icon" className="flex shrink-0 text-muted-foreground">
        <ChevronsUpDown aria-hidden />
      </Select.Icon>
    </Select.Trigger>
  )
}

function SelectPopup({ className, ...props }: React.ComponentProps<typeof Select.Popup>) {
  return (
    <Select.Portal data-slot="select-portal">
      <Select.Positioner data-slot="select-positioner" sideOffset={4}>
        <Select.Popup
          data-slot="select-popup"
          className={cn(
            'scroll-slim z-50 max-h-64 min-w-(--anchor-width) overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none transition ease-out duration-150 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </Select.Positioner>
    </Select.Portal>
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof Select.Item>) {
  return (
    <Select.Item
      data-slot="select-item"
      className={cn(
        'relative flex min-h-8 cursor-pointer pointer-coarse:min-h-10 items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm outline-none select-none focus:bg-muted data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Select.ItemIndicator
        data-slot="select-item-indicator"
        className="absolute left-2 flex size-4 items-center justify-center"
      >
        <Check aria-hidden className="size-3.5" />
      </Select.ItemIndicator>
      <Select.ItemText data-slot="select-item-text" className="min-w-0 flex-1 truncate">
        {children}
      </Select.ItemText>
    </Select.Item>
  )
}

export { SelectRoot, SelectTrigger, SelectPopup, SelectItem }
