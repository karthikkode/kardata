// Action menu over Base UI: trigger plus one expanded option list with
// keyboard traversal owned by the primitive. One action per row; one
// submenu level (MenuSubmenu*) for grouped choices like effort levels.
import * as React from 'react'
import { Menu } from '@base-ui/react/menu'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

function MenuRoot(props: React.ComponentProps<typeof Menu.Root>) {
  return <Menu.Root data-slot="menu" {...props} />
}

function MenuTrigger({ className, ...props }: React.ComponentProps<typeof Menu.Trigger>) {
  return <Menu.Trigger data-slot="menu-trigger" className={className} {...props} />
}

function MenuPopup({ className, children, ...props }: React.ComponentProps<typeof Menu.Popup>) {
  return (
    <Menu.Portal data-slot="menu-portal">
      <Menu.Positioner data-slot="menu-positioner" sideOffset={4} className="z-50 outline-none">
        <Menu.Popup
          data-slot="menu-popup"
          className={cn(
            'scroll-slim max-h-80 min-w-40 origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md outline-none transition-all duration-120 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function MenuItem({ className, ...props }: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      data-slot="menu-item"
      className={cn(
        'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-hover data-highlighted:text-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

function MenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem
      data-slot="menu-checkbox-item"
      className={cn(
        'relative flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pr-2 pl-8 text-left text-ui outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-hover data-highlighted:text-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <Menu.CheckboxItemIndicator
        data-slot="menu-checkbox-item-indicator"
        className="absolute left-2 flex size-4 items-center justify-center text-primary-text"
      >
        <Check aria-hidden />
      </Menu.CheckboxItemIndicator>
      {children}
    </Menu.CheckboxItem>
  )
}

function MenuRadioGroup(props: React.ComponentProps<typeof Menu.RadioGroup>) {
  return <Menu.RadioGroup data-slot="menu-radio-group" {...props} />
}

function MenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem
      data-slot="menu-radio-item"
      className={cn(
        'relative flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pr-2 pl-8 text-left text-ui outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-hover data-highlighted:text-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <Menu.RadioItemIndicator
        data-slot="menu-radio-item-indicator"
        className="absolute left-2 flex size-4 items-center justify-center text-primary-text"
      >
        <Check aria-hidden />
      </Menu.RadioItemIndicator>
      {children}
    </Menu.RadioItem>
  )
}

function MenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      data-slot="menu-label"
      className={cn('px-2 pt-1.5 pb-1 text-2xs font-medium tracking-[0.05em] text-foreground-subtle uppercase', className)}
      {...props}
    />
  )
}

function MenuSeparator({ className, ...props }: React.ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      data-slot="menu-separator"
      className={cn('mx-1 my-1 border-t border-border-subtle', className)}
      {...props}
    />
  )
}

function MenuGroup(props: React.ComponentProps<typeof Menu.Group>) {
  return <Menu.Group data-slot="menu-group" {...props} />
}

function MenuSubmenuRoot(props: React.ComponentProps<typeof Menu.SubmenuRoot>) {
  return <Menu.SubmenuRoot data-slot="menu-submenu" {...props} />
}

function MenuSubmenuTrigger({ className, children, ...props }: React.ComponentProps<typeof Menu.SubmenuTrigger>) {
  return (
    <Menu.SubmenuTrigger
      data-slot="menu-submenu-trigger"
      className={cn(
        'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-hover data-highlighted:text-foreground data-popup-open:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
    </Menu.SubmenuTrigger>
  )
}

function MenuSubmenuPopup({ className, children, ...props }: React.ComponentProps<typeof Menu.Popup>) {
  return (
    <Menu.Portal data-slot="menu-submenu-portal">
      <Menu.Positioner data-slot="menu-submenu-positioner" sideOffset={4} alignOffset={-4} className="z-50 outline-none">
        <Menu.Popup
          data-slot="menu-submenu-popup"
          className={cn(
            'scroll-slim max-h-80 min-w-40 origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md outline-none transition-all duration-120 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export {
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuLabel,
  MenuSeparator,
  MenuGroup,
  MenuSubmenuRoot,
  MenuSubmenuTrigger,
  MenuSubmenuPopup,
}
