// Overlay stacking: sibling overlays render side by side (the inspector
// beside local context, a confirm inside options), so no shared tree
// coordinates their Escape handling. Each open overlay registers while
// its `open` prop is true and deregisters when it flips false or
// unmounts; an Escape-driven close runs only for the topmost entry, so
// one keypress never dismisses two surfaces. Registration follows actual
// open state (reopening re-registers), and a refused close keeps its
// registration because nothing was removed.
import { useEffect, useRef } from 'react'

const stack: Array<symbol> = []

function releaseToken(token: symbol): void {
  const index = stack.indexOf(token)
  if (index >= 0) stack.splice(index, 1)
}

export function useTopmostOverlay(open: boolean): {
  /** Run close only while this overlay is the topmost open entry. */
  guard: (close: () => void) => void
} {
  const token = useRef<symbol | null>(null)
  if (token.current === null) token.current = Symbol('overlay')
  useEffect(() => {
    if (!open) return
    const current = token.current as symbol
    if (!stack.includes(current)) stack.push(current)
    return () => releaseToken(current)
  }, [open ])
  const current = token.current
  return {
    guard: (close: () => void) => {
      if (stack[stack.length - 1] === current) close()
    },
  }
}
