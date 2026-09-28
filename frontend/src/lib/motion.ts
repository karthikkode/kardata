import { useEffect, useRef, useState } from 'react'

// One motion scale for the mockup layer, matching documentation/frontend.md:
// 200ms ease-out for enters, exits, and section changes. JS needs the
// duration for exit unmount timing; the matching keyframes live in the
// enter/exit class strings below. Change both together.
export const EXIT_MS = 200

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Popovers, menus, and the dock share one enter/exit pair: fade with a
// small scale drift. Consumers swap the pair on `closing`. The dock drifts
// sideways instead, matching a sheet leaving the edge.
export const popoverEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200'
export const popoverExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:zoom-out-95 motion-safe:duration-200'
export const dockEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200'
export const dockExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-right-4 motion-safe:duration-200'

type ExitState = 'open' | 'closing' | 'closed'

// Delayed unmount so a closing surface can play its exit keyframes, without
// any setState-in-effect: every transition runs from event handlers.
// `set(false)` starts the exit and unmounts after EXIT_MS; `set(true)`
// reopens instantly and cancels a mid-exit close. Under reduced motion
// there is no delay: the surface unmounts at once with all content and
// focus work intact.
export function useExitState(initial = false): {
  open: boolean
  mounted: boolean
  closing: boolean
  set: (next: boolean) => void
} {
  const [state, setState] = useState<ExitState>(initial ? 'open' : 'closed')
  const stateRef = useRef<ExitState>(initial ? 'open' : 'closed')
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  function set(next: boolean) {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (next) {
      stateRef.current = 'open'
      setState('open')
      return
    }
    // Closing an already-closed surface is a no-op: without this guard
    // every unrelated toggle briefly mounts a ghost surface (plus its
    // dismiss overlay) that swallows the next click.
    if (stateRef.current === 'closed') return
    if (prefersReducedMotion()) {
      stateRef.current = 'closed'
      setState('closed')
      return
    }
    stateRef.current = 'closing'
    setState('closing')
    timer.current = window.setTimeout(() => {
      timer.current = null
      stateRef.current = 'closed'
      setState('closed')
    }, EXIT_MS)
  }

  return {
    open: state === 'open',
    mounted: state !== 'closed',
    closing: state === 'closing',
    set,
  }
}
