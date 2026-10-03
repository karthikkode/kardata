// Owned tabs over Base UI: controlled selection with correct tab/panel
// relationships and keyboard behavior owned by the primitive. Tab changes
// must not discard drafts or remount durable conversation state: keep tab
// bodies mounted (hidden) where state must survive.
//
// Underline is the default: a 2px indicator slides between tabs over
// 180ms (shared layoutId per group). The segmented variant suits 2-3
// option toggles with a sliding thumb instead.
import * as React from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { LazyMotion, domAnimation, m } from 'motion/react'
import { tabIndicatorTransition } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type TabsVariant = 'underline' | 'segmented'

const TabsVariantContext = React.createContext<{ variant: TabsVariant; groupId: string }>({
  variant: 'underline',
  groupId: 'tabs',
})

function TabIndicator() {
  const { variant, groupId } = React.useContext(TabsVariantContext)
  return (
    <LazyMotion features={domAnimation}>
      <m.span
        data-slot="tab-indicator"
        layoutId={`tab-ind-${groupId}`}
        transition={tabIndicatorTransition}
        className={
          variant === 'segmented'
            ? 'absolute inset-0 rounded-sm bg-card shadow-xs'
            : 'absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground'
        }
      />
    </LazyMotion>
  )
}

function TabsRoot({ className, ...props }: React.ComponentProps<typeof Tabs.Root>) {
  return <Tabs.Root data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props} />
}

function TabsList({
  className,
  variant = 'underline',
  ...props
}: React.ComponentProps<typeof Tabs.List> & { variant?: TabsVariant }) {
  const groupId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <TabsVariantContext.Provider value={{ variant, groupId }}>
      <Tabs.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          variant === 'segmented'
            ? 'flex w-fit items-center gap-0.5 rounded-md bg-surface-sunken p-0.5'
            : 'flex items-center gap-4 border-b border-border-subtle',
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTab({ className, children, ...props }: React.ComponentProps<typeof Tabs.Tab>) {
  const { variant } = React.useContext(TabsVariantContext)
  const tabClassName = cn(
    variant === 'segmented'
      ? 'relative z-0 h-8 pointer-coarse:h-10 shrink-0 cursor-pointer rounded-sm px-3 text-ui font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors duration-120 ease-out-soft hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-selected:text-foreground'
      : 'relative h-10 pointer-coarse:min-w-10 shrink-0 cursor-pointer px-1 text-ui font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors duration-120 ease-out-soft hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-selected:text-foreground',
    className,
  )
  return (
    <Tabs.Tab
      data-slot="tabs-tab"
      className={tabClassName}
      render={(elementProps, state) => (
        <button {...elementProps} className={tabClassName}>
          {variant === 'segmented' ? <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span> : children}
          {(state as Tabs.Tab.State).active ? <TabIndicator /> : null}
        </button>
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
