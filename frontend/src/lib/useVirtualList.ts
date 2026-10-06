// Shared virtualized-list setup for scale surfaces (sessions menu,
// subagent list, queue). TanStack renders the visible window plus a
// small overhang; rows measure themselves so estimates self-correct.
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/** Wire a scroll container to a count/estimate virtualizer. The caller
 * keeps its scrollport classes; the sizer div drives the scrollbar. */
export function useVirtualList(count: number, estimateSize: number) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 3,
  })
  return { parentRef, virtualizer }
}
