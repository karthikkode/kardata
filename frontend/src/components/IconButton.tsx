// IconButton: the only way to render an icon-only button. The label is
// required: it becomes the accessible name AND the visible tooltip (with
// an optional shortcut chip). Sizes: icon (40px) and icon-sm (32px,
// 40px on small screens for touch).
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Kbd } from './text'
import { Button } from './ui/button'
import { TooltipPopup, TooltipRoot, TooltipTrigger } from './ui/tooltip'

export function IconButton({
  label,
  shortcut,
  size = 'icon-sm',
  side,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size' | 'children' | 'aria-label'> & {
  label: string
  shortcut?: string
  size?: 'icon' | 'icon-sm'
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: React.ReactNode
}) {
  return (
    <TooltipRoot>
      <TooltipTrigger
        render={
          <Button variant="ghost" size={size} aria-label={label} className={cn('shrink-0', className)} {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side={side}>
        <span className="inline-flex items-center gap-1.5">
          {label}
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </span>
      </TooltipPopup>
    </TooltipRoot>
  )
}
