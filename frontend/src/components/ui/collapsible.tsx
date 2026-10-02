// Owned collapsible over Base UI: accessible trigger/content relationship
// with preserved open state. The panel animates height over 180ms with a
// 120ms content fade; chevrons rotate 180ms (see motion presets).
import * as React from 'react'
import { Collapsible } from '@base-ui/react/collapsible'
import { cn } from '@/lib/utils'

function CollapsibleRoot(props: React.ComponentProps<typeof Collapsible.Root>) {
  return <Collapsible.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ className, ...props }: React.ComponentProps<typeof Collapsible.Trigger>) {
  return (
    <Collapsible.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium outline-none transition-colors duration-120 ease-out-soft hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg[data-chevron]]:transition-transform [&_svg[data-chevron]]:duration-180 [&_svg[data-chevron]]:ease-out data-open:[&_svg[data-chevron]]:rotate-180',
        className,
      )}
      {...props}
    />
  )
}

function CollapsiblePanel({ className, keepMounted = false, ...props }: React.ComponentProps<typeof Collapsible.Panel> & { keepMounted?: boolean }) {
  return (
    <Collapsible.Panel
      data-slot="collapsible-panel"
      keepMounted={keepMounted}
      className={cn(
        'h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-180 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

export { CollapsibleRoot, CollapsibleTrigger, CollapsiblePanel }
