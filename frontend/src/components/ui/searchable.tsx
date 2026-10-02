// Searchable selection over Base UI Combobox: model/session selection with
// filtering, a selected marker, and an explicit no-match state. Used where
// the choice list is long or backend-supplied (models, sessions, files).
import * as React from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

function SearchableRoot<T>(props: React.ComponentProps<typeof Combobox.Root<T>>) {
  return <Combobox.Root<T> data-slot="searchable" {...props} />
}

function SearchableInput({ className, ...props }: React.ComponentProps<typeof Combobox.Input>) {
  return (
    <Combobox.Input
      data-slot="searchable-input"
      className={cn(
        'h-10 w-full min-w-0 rounded-md border border-input bg-surface-sunken px-3 text-sm outline-none transition-colors duration-120 ease-out-soft placeholder:text-foreground-subtle focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function SearchableTrigger({ className, ...props }: React.ComponentProps<typeof Combobox.Trigger>) {
  return (
    <Combobox.Trigger
      data-slot="searchable-trigger"
      className={cn(
        'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input text-muted-foreground outline-none transition-colors duration-120 ease-out-soft hover:border-border-strong hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
        className,
      )}
      {...props}
    >
      <ChevronsUpDown aria-hidden />
    </Combobox.Trigger>
  )
}

function SearchablePopup({ className, ...props }: React.ComponentProps<typeof Combobox.Popup>) {
  return (
    <Combobox.Portal data-slot="searchable-portal">
      <Combobox.Positioner data-slot="searchable-positioner" sideOffset={4} className="z-50 outline-none">
        <Combobox.Popup
          data-slot="searchable-popup"
          className={cn(
            'min-w-32 origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-border bg-popover text-ui text-popover-foreground shadow-md outline-none transition-all duration-120 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </Combobox.Positioner>
    </Combobox.Portal>
  )
}

function SearchableList({ className, ...props }: React.ComponentProps<typeof Combobox.List>) {
  return (
    <Combobox.List
      data-slot="searchable-list"
      className={cn('scroll-slim max-h-60 overflow-y-auto p-1 outline-none', className)}
      {...props}
    />
  )
}

function SearchableItem({ className, children, ...props }: React.ComponentProps<typeof Combobox.Item>) {
  return (
    <Combobox.Item
      data-slot="searchable-item"
      className={cn(
        'relative flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pr-8 pl-2 text-ui outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-hover data-highlighted:text-foreground data-selected:bg-primary-soft [&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <Combobox.ItemIndicator
        data-slot="searchable-item-indicator"
        className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center text-primary-text"
      >
        <Check aria-hidden className="size-3.5" />
      </Combobox.ItemIndicator>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Combobox.Item>
  )
}

function SearchableEmpty({ className, ...props }: React.ComponentProps<typeof Combobox.Empty>) {
  return (
    <Combobox.Empty
      data-slot="searchable-empty"
      className={cn('px-3 py-6 text-center text-ui text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  SearchableRoot,
  SearchableInput,
  SearchableTrigger,
  SearchablePopup,
  SearchableList,
  SearchableItem,
  SearchableEmpty,
}
