// Single-select listbox over Base UI: one expanded option list with
// typeahead owned by the primitive. One value per field; multi-select and
// combobox filtering stay out.
import * as React from 'react'
import { Select } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRingInput } from '@/lib/interaction'

function SelectRoot<T>(props: React.ComponentProps<typeof Select.Root<T>>) {
  return <Select.Root<T> data-slot="select" {...props} />
}

function SelectTrigger({
  className,
  valueText,
  ...props
}: React.ComponentProps<typeof Select.Trigger> & {
  /** Fixed trigger text (e.g. "Status: All") instead of the selected item text. */
  valueText?: React.ReactNode
}) {
  return (
    <Select.Trigger
      data-slot="select-trigger"
      className={cn(
        `flex h-10 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-surface-sunken px-3 text-sm transition-colors duration-120 ease-out-soft ${focusRingInput} hover:border-border-strong disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground`,
        className,
      )}
      {...props}
    >
      {valueText !== undefined ? (
        <span data-slot="select-value" className="min-w-0 flex-1 truncate text-left">
          {valueText}
        </span>
      ) : (
        <Select.Value data-slot="select-value" className="min-w-0 flex-1 truncate text-left" />
      )}
      <Select.Icon data-slot="select-icon">
        <ChevronsUpDown aria-hidden />
      </Select.Icon>
    </Select.Trigger>
  )
}

function SelectPopup({ className, children, ...props }: React.ComponentProps<typeof Select.Popup>) {
  return (
    <Select.Portal data-slot="select-portal">
      <Select.Positioner data-slot="select-positioner" sideOffset={4} className="z-50 outline-none">
        <Select.Popup
          data-slot="select-popup"
          className={cn(
            'scroll-slim max-h-72 min-w-32 origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md outline-none transition-all duration-120 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof Select.Item>) {
  return (
    <Select.Item
      data-slot="select-item"
      className={cn(
        'relative flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pr-8 pl-2 text-ui outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-hover data-highlighted:text-foreground data-selected:bg-primary-soft [&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <Select.ItemText className="min-w-0 flex-1 truncate">{children}</Select.ItemText>
      <Select.ItemIndicator
        data-slot="select-item-indicator"
        className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center text-primary-text"
      >
        <Check aria-hidden />
      </Select.ItemIndicator>
    </Select.Item>
  )
}

export { SelectRoot, SelectTrigger, SelectPopup, SelectItem }
