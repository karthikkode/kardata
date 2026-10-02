import { useEffect, useRef, useState } from 'react'

// One motion scale for the whole app, exactly the handoff table (2.7):
// hover/pressed/color 150ms ease-out; page/section 200ms opacity crossfade
// (implemented by the View Transitions API in useNavigation, with the
// pageEnter/pageExit class pair as the no-API fallback); dialog 200ms
// opacity + 8px rise; menu/popover 150ms opacity + 4px rise;
// drawer/dock 200ms opacity + 16px from its edge; new rows and settled
// messages 150ms opacity + 4px rise (entering content only, never a remount
// of history); inline notices 150ms opacity; disclosures change layout
// immediately with a 150ms content fade; chevrons rotate 150ms; skeletons
// pulse only while loading and stay static under reduced motion.
//
// Base UI overlay primitives (dialog, alert-dialog, menu, popover,
// tooltip, select, searchable, collapsible) implement their enter AND exit
// through data-starting-style/data-ending-style transitions in the owned
// ui/* wrappers, so Base UI retains and unmounts the exiting popup with no
// second timer. The class pairs below remain the single implementation for
// useExitState-managed surfaces (dock, custom composer menus, mention and
// skill lists), which swap enter/exit on `closing`. Motion-powered feature
// markup uses the lightweight `m` component under `LazyMotion
// features={domAnimation}` (both App roots). Change constants with the CSS
// together. No springs, overshoot, parallax, drag, scroll-linked effects,
// or animated counters.
export const EXIT_MS = 200
export const POPOVER_MS = 150

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Menu/popover/select/tooltip/file-menus: 150ms opacity plus 4px vertical
// translation. The dock drifts sideways instead, matching a sheet leaving
// the edge (200ms opacity plus 16px). Dialogs rise 8px over 200ms.
// Consumers swap the enter pair for the exit pair on `closing`.
export const popoverEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150'
export const popoverExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-bottom-1 motion-safe:duration-150'
export const dockEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200'
export const dockExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-right-4 motion-safe:duration-200'
// Dialogs and alert dialogs: 200ms opacity plus 8px vertical translation.
export const dialogEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200'
export const dialogExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-bottom-2 motion-safe:duration-200'
// Page/section replacement: 200ms opacity crossfade. Outgoing content turns
// inert during replacement; focus moves to the new heading after commit.
export const pageEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200'
export const pageExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:duration-200'
// New list rows and newly settled messages: 150ms opacity plus 4px rise,
// applied to the entering node only. History never reanimates on poll,
// reconnect, or thread switch; streaming text never animates per token.
export const rowEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150'
// Inline operation notices: 150ms opacity only, no movement.
export const noticeEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150'

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
