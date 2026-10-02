// Owned tabs over Base UI: controlled selection with correct tab/panel
// relationships and keyboard behavior owned by the primitive. Tab changes
// must not discard drafts or remount durable conversation state: keep tab
// bodies mounted (hidden) where state must survive.
import * as React from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { cn } from 'cn'

function TabsRoot({ className, ...props }: React.ComponentProps<typeof Tabs.Root>) {
  return <Tabs.Root data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof Tabs.List>) {
  return (
    <Tabs.List
      data-slot="tabs-list"
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-1',
        className,
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: React.ComponentProps<typeof Tabs.Tab>) {
  return (
    <Tabs.Tab
      data-slot="tabs-tab"
      className={cn(
        'h-10 shrink-0 cursor-pointer rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-selected:bg-background data-selected:text-foreground data-selected:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: React.ComponentProps<typeof Tabs.Panel>) {
  return (
    <Tabs.Panel
      data-slot="tabs-panel"
      className={cn('min-w-0 flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { TabsRoot, TabsList, TabsTab, TabsPanel }
