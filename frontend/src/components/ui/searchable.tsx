// Searchable selection over Base UI Combobox: model/session selection with
// filtering, a selected marker, and an explicit no-match state. Used where
// the choice list is long or backend-supplied (models, sessions, files).
import * as React from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from 'cn'

function SearchableRoot<T>(props: React.ComponentProps<typeof Combobox.Root<T>>) {
  return <Combobox.Root<T> data-slot="searchable" {...props} />
}

function SearchableInput({ className, ...props }: React.ComponentProps<typeof Combobox.Input>) {
  return (
    <Combobox.Input
      data-slot="searchable-input"
      className={cn(
        'h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
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
        'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
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
      <Combobox.Positioner data-slot="searchable-positioner" sideOffset={4}>
        <Combobox.Popup
          data-slot="searchable-popup"
          className={cn(
            'z-50 min-w-(--anchor-width) overflow-hidden rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg outline-none transition ease-out duration-150 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0',
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
      className={cn('scroll-slim max-h-64 overflow-y-auto p-1 outline-none', className)}
      {...props}
    />
  )
}

function SearchableItem({ className, children, ...props }: React.ComponentProps<typeof Combobox.Item>) {
  return (
    <Combobox.Item
      data-slot="searchable-item"
      className={cn(
        'relative flex min-h-8 cursor-pointer pointer-coarse:min-h-10 items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm outline-none select-none focus:bg-muted data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Combobox.ItemIndicator
        data-slot="searchable-item-indicator"
        className="absolute left-2 flex size-4 items-center justify-center"
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
      className={cn('px-3 py-6 text-center text-sm text-muted-foreground', className)}
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
