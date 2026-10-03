import { useEffect, useRef, useState } from 'react'

// One motion scale for the whole app (plan 2.6): hover/pressed/color
// 120ms; page replacement 120ms out plus 180ms rise-in (implemented by the
// View Transitions API in useNavigation, with the pageEnter/pageExit class
// pair as the no-API fallback); dialog 180ms opacity plus scale plus 4px
// rise; menu/popover 120ms opacity plus scale from the transform origin;
// drawer/dock 240ms in (opacity plus 16px from its edge), 180ms out; new
// rows and settled messages 180ms opacity plus 4px rise (entering content
// only, never a remount of history); inline notices 120ms opacity;
// disclosures animate height over 180ms with a 120ms content fade;
// chevrons rotate 180ms; skeletons sheen while loading and stay static
// under reduced motion; stat numbers count up once on first mount (see
// lib/animate-number.ts), polls swap instantly.
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
// together. No springs, overshoot, parallax, drag, or scroll-linked
// effects.

/** JS mirror of the CSS motion tokens (ms durations, bezier tuples). */
export const MOTION = {
  fast: 120,
  base: 180,
  slow: 240,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
  easeSoft: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
}

export const EXIT_MS = 180
export const POPOVER_MS = 120

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Menu/popover/select/tooltip/file-menus: 120ms opacity plus scale from
// the transform origin, 100ms opacity-only exit. The dock slides sideways
// instead, matching a sheet leaving the edge (240ms in, 180ms out).
// Dialogs rise 4px with scale over 180ms. Consumers swap the enter pair
// for the exit pair on `closing`.
export const popoverEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-120'
export const popoverExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:duration-100'
export const dockEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-240'
export const dockExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-right-4 motion-safe:duration-180'
// Dialogs and alert dialogs: 180ms opacity plus 4px rise with scale;
// 120ms opacity exit.
export const dialogEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:zoom-in-95 motion-safe:duration-180'
export const dialogExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:zoom-out-95 motion-safe:duration-120'
// Page/section replacement: old fades over 120ms; new rises 4px over
// 180ms. Outgoing content turns inert during replacement; focus moves to
// the new heading after commit.
export const pageEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-180'
export const pageExit =
  'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:duration-120'
// New list rows and newly settled messages: 180ms opacity plus 4px rise,
// applied to the entering node only. History never reanimates on poll,
// reconnect, or thread switch; streaming text never animates per token.
export const rowEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-180'
// Inline operation notices: 120ms opacity only, no movement.
export const noticeEnter =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-120'
// Live-inserted rows via motion: initial keyframe for the entering node.
// The animate target is opacity 1 / y 0 over 180ms at the call site.
/** Stagger delay for item N: 30ms each, capped at the first 12 items. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index), 11) * 0.03
}
/** Sliding tab indicator (shared layoutId per group). */
export const tabIndicatorTransition = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
}

/** Sliding sidebar indicator (shared layoutId `nav-active`). */
export const navIndicatorTransition = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
}

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
