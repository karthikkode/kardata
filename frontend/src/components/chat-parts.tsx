// Shared chat chrome: timestamp dividers plus the user/agent bubble
// shells and the centered agent mark. Token-only styling (primary, muted,
// border) so every panel that adopts these rows looks like one product.
// Karbot keeps its own layout; it only shares overflow-safe Markdown.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { sessionAge } from './ChatPanel'

/** Gap that opens a timestamp divider between two stamped rows. */
export const DIVIDER_GAP_MS = 5 * 60 * 1000

/** True when two ISO timestamps are far enough apart to split the flow. */
export function splitAfter(previous: string | undefined, next: string | undefined): boolean {
  if (!previous || !next) return false
  const before = Date.parse(previous)
  const after = Date.parse(next)
  if (Number.isNaN(before) || Number.isNaN(after)) return false
  return after - before > DIVIDER_GAP_MS
}

/** Centered relative-time divider, mirroring the timestamps under bubbles. */
export function TimeDivider({ at }: { at: string }) {
  return (
    <div className="flex items-center gap-2 py-1 select-none">
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="shrink-0 text-xs text-muted-foreground">{sessionAge(at)}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  )
}

/** Right-aligned user bubble. Shrink-wraps short messages, caps at 85%,
 * and stays a soft primary tint, quiet against the muted agent bubble.
 * Wraps anywhere so pasted tokens never spill. */
export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/10 px-3.5 py-2 text-sm text-foreground shadow-xs [overflow-wrap:anywhere]">
      {children}
    </div>
  )
}

/** Left-aligned agent bubble. Same wrap guarantee as the user side. */
export function AgentBubble({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-full px-1 py-1 text-sm leading-relaxed [overflow-wrap:anywhere]">
      {children}
    </div>
  )
}

/** Stick-to-bottom autoscroll shared by chat lists. New content pins the
 * list only while the reader is already at the bottom (48px threshold);
 * scrolling up reveals a jump pill instead of yanking the reader.
 * Pass a key that changes whenever the visible flow grows. */
export function useChatStick(activityKey: string) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const stuckRef = useRef(true)
  const [showLatest, setShowLatest] = useState(false)

  function pinToBottom() {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }

  function onListScroll() {
    const element = listRef.current
    if (!element) return
    const stuck = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    stuckRef.current = stuck
    setShowLatest(!stuck && element.scrollHeight > element.clientHeight)
  }

  function jumpToLatest() {
    stuckRef.current = true
    setShowLatest(false)
    pinToBottom()
  }

  function resetPin() {
    stuckRef.current = true
    setShowLatest(false)
  }

  useEffect(() => {
    if (stuckRef.current) pinToBottom()
  }, [activityKey])

  return { listRef, showLatest, onListScroll, jumpToLatest, resetPin }
}

/** Centered agent identity: initial-letter mark plus the chat name. */
export function AgentMark({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '•'
  return (
    <span className="flex min-w-0 items-center justify-center gap-2 select-none">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      >
        {initial}
      </span>
      <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
    </span>
  )
}
