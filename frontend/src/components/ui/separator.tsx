// Token border with consistent spacing. A separator is visual structure,
// not content: aria-hidden through the primitive.
import * as React from 'react'
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cn } from 'cn'

function Separator({ className, ...props }: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      className={cn(
        'shrink-0 border-border data-horizontal:h-px data-horizontal:w-full data-horizontal:border-t data-vertical:h-full data-vertical:w-px data-vertical:border-l',
        className,
      )}
      {...props}
    />
  )
}

export { Separator }
