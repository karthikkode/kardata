// Reserved geometry while loading: an opaque block with a translating
// sheen. Static under reduced motion. Shape the skeleton to the row it
// replaces; never generic shimmer bars unrelated to the content.
import * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'skeleton-sheen rounded-sm bg-muted motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}
