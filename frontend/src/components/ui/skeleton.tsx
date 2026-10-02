// Reserved geometry while loading. Static under reduced motion (no pulse
// when the OS asks for stillness). Shape the skeleton to the row it
// replaces; never generic shimmer bars unrelated to the content.
import * as React from 'react'
import { cn } from 'cn'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'rounded-md bg-muted motion-safe:animate-pulse motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}
