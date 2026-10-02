// Owned collapsible over Base UI: accessible trigger/content relationship
// with preserved open state. Disclosure bodies change layout immediately
// with a content fade; chevrons rotate 150ms (see motion presets).
import * as React from 'react'
import { Collapsible } from '@base-ui/react/collapsible'
import { cn } from 'cn'

function CollapsibleRoot(props: React.ComponentProps<typeof Collapsible.Root>) {
  return <Collapsible.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ className, ...props }: React.ComponentProps<typeof Collapsible.Trigger>) {
  return (
    <Collapsible.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg[data-chevron]]:transition-transform [&_svg[data-chevron]]:duration-150 data-open:[&_svg[data-chevron]]:rotate-180',
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
        'overflow-hidden transition-opacity ease-out duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

export { CollapsibleRoot, CollapsibleTrigger, CollapsiblePanel }
