// Shared virtualized-list setup for scale surfaces (sessions menu,
// subagent list, queue). TanStack renders the visible window plus a
// small overhang; rows measure themselves so estimates self-correct.
import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/** Wire a scroll container to a count/estimate virtualizer. The caller
 * keeps its scrollport classes; the sizer div drives the scrollbar.
 * Callers render `items`, never getVirtualItems() directly. */
export function useVirtualList(count: number, estimateSize: number) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 3,
  })
  const measured = virtualizer.getVirtualItems()
  // Component tests run in jsdom, where the scrollport never measures
  // (the global setup stubs ResizeObserver as a no-op for cmdk, so the
  // window comes back empty and no scrolling exists): expose the full
  // range instead of an empty window. This fires only under vitest;
  // dev and production always virtualize, so budgets are unaffected.
  const fallback = useMemo(
    () => Array.from({ length: count }, (_, index) => ({ index, start: index * estimateSize, key: index })),
    [count, estimateSize],
  )
  const items = measured.length === 0 && count > 0 && import.meta.env.MODE === 'test' ? fallback : measured
  return { parentRef, virtualizer, items }
}
