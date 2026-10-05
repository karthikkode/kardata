// Shared chat chrome: timestamp dividers plus the user/agent bubble
// shells and the centered agent mark. Token-only styling (primary, muted,
// border) so every panel that adopts these rows looks like one product.
// Karbot keeps its own layout; it only shares overflow-safe Markdown.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { formatFullDate } from '../lib/format'
import { notify } from '../lib/toast'
import { sessionAge } from './chat/messages'
import { Caption } from './text'
import { Button } from './ui/button'

/** Gap that opens a timestamp divider between two stamped rows. */
const DIVIDER_GAP_MS = 5 * 60 * 1000

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

/** Right-aligned user bubble (CV-02). Shrink-wraps short messages,
 * caps at 85%, and stays a neutral active tint. Wraps anywhere so
 * pasted tokens never spill. */
export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-surface-active px-3.5 py-2.5 text-sm leading-[22px] text-foreground [overflow-wrap:anywhere]">
      {children}
    </div>
  )
}

/** Agent message, never a bubble (CV-03/04). Same wrap guarantee as
 * the user side. Settled replies (never live or streaming text) carry
 * a Copy action plus a timestamp, revealed on hover/focus (always on
 * touch and on the latest message). No regenerate or edit actions exist. */
export function AgentBubble({ children, copyText, timestamp, latest = false }: { children: ReactNode; copyText?: string; timestamp?: string; latest?: boolean }) {
  async function copy() {
    if (copyText === undefined) return
    try {
      await navigator.clipboard.writeText(copyText)
      notify.success('Copied')
    } catch {
      notify.error('Copy failed. Try again.')
    }
  }
  return (
    <div className="group min-w-0 max-w-full text-sm leading-[22px] [overflow-wrap:anywhere]">
      {children}
      {copyText !== undefined ? (
        <div className={cn('mt-1 flex items-center gap-2 transition-opacity duration-120', latest ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100')}>
          <Button type="button" variant="ghost" size="xs" onClick={() => void copy()}>
            <Icons.copy aria-hidden />
            Copy
          </Button>
          {timestamp ? (
            <Caption as="span">
              <time dateTime={timestamp} title={formatFullDate(timestamp)} className="tabular-nums">{sessionAge(timestamp)}</time>
            </Caption>
          ) : null}
        </div>
      ) : null}
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

  useEffect(() => {
    // A fresh log with content starts pinned: the conversation view
    // remounts on thread switches while the messages stay in hook state,
    // so the activity effect above would otherwise never re-run for them.
    if (stuckRef.current) pinToBottom()
  }, [])

  useEffect(() => {
    // The assistant runtime renders a commit behind our segments (and
    // images/fonts settle later still), so a single post-commit pin reads
    // a stale height. While stuck, follow every growth instead.
    const element = listRef.current
    // The content wrapper, not the log: the log's own box never changes
    // size, so only the wrapper's growth observes the late renders.
    const content = element?.firstElementChild
    if (!element || !content || typeof ResizeObserver === 'undefined') return
    let lastHeight = element.scrollHeight
    const observer = new ResizeObserver(() => {
      const height = element.scrollHeight
      const grew = height > lastHeight
      lastHeight = height
      if (grew && stuckRef.current) pinToBottom()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  return { listRef, showLatest, onListScroll, jumpToLatest, resetPin }
}

/** Centered agent identity: initial-letter mark plus the chat name. */
export function AgentMark({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '•'
  return (
    <span className="flex min-w-0 items-center justify-center gap-2 select-none">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      >
        {initial}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
    </span>
  )
}
