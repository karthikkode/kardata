// Owned menu over Base UI: roving focus, Escape, outside dismissal, and
// trigger restoration are primitive-owned. Popup is portaled with collision
// handling; only one system owns the exit (useExitState in the caller for
// controlled retention, never a second timeout).
import * as React from 'react'
import { Menu } from '@base-ui/react/menu'
import { Check } from 'lucide-react'
import { cn } from 'cn'

function MenuRoot(props: React.ComponentProps<typeof Menu.Root>) {
  return <Menu.Root data-slot="menu" {...props} />
}

function MenuTrigger({ className, ...props }: React.ComponentProps<typeof Menu.Trigger>) {
  return <Menu.Trigger data-slot="menu-trigger" className={className} {...props} />
}

function MenuPopup({ className, ...props }: React.ComponentProps<typeof Menu.Popup>) {
  return (
    <Menu.Portal data-slot="menu-portal">
      <Menu.Positioner data-slot="menu-positioner" sideOffset={4}>
        <Menu.Popup
          data-slot="menu-popup"
          className={cn(
            'scroll-slim z-50 max-h-64 min-w-40 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none transition ease-out duration-150 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function MenuItem({ className, ...props }: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      data-slot="menu-item"
      className={cn(
        'flex min-h-8 cursor-pointer pointer-coarse:min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none focus:bg-muted data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

function MenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem
      data-slot="menu-checkbox-item"
      className={cn(
        'flex min-h-8 cursor-pointer pointer-coarse:min-h-10 items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm outline-none select-none focus:bg-muted data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Menu.CheckboxItemIndicator
        data-slot="menu-checkbox-indicator"
        className="absolute left-2 flex size-4 items-center justify-center"
      >
        <Check aria-hidden className="size-3.5" />
      </Menu.CheckboxItemIndicator>
      {children}
    </Menu.CheckboxItem>
  )
}

function MenuSeparator({ className, ...props }: React.ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      data-slot="menu-separator"
      className={cn('mx-1 my-1 border-t border-border', className)}
      {...props}
    />
  )
}

function MenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      data-slot="menu-label"
      className={cn('px-2 py-1 text-xs font-medium text-muted-foreground select-none', className)}
      {...props}
    />
  )
}

export { MenuRoot, MenuTrigger, MenuPopup, MenuItem, MenuCheckboxItem, MenuSeparator, MenuLabel }
