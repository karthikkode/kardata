// Session subagent threads, docked just above the composer. Rows come
// from the backend thread list: status dot, thread key, and queue depth.
// Stopping cancels the thread's run through the parent. There is no local
// launching or staged progress: every row on screen was served by the API.
import { useState } from 'react'
import { ChevronDown, MessageSquare, Square } from 'lucide-react'
import { popoverEnter, popoverExit, useExitState } from '@/lib/motion'
import type { ThreadView } from '../data/staging-api'
import { toneDot } from './StatusPill'
import { Button } from './ui/button'

function toneFor(status: string): 'working' | 'ok' | 'failed' | 'idle' {
  if (/running/i.test(status)) return 'working'
  if (/done|finished|complete/i.test(status)) return 'ok'
  if (/fail|error/i.test(status)) return 'failed'
  return 'idle'
}

function labelFor(status: string): string {
  if (/running/i.test(status)) return 'Running'
  if (/done|finished|complete/i.test(status)) return 'Done'
  if (/fail|error/i.test(status)) return 'Failed'
  if (/stop|cancel/i.test(status)) return 'Stopped'
  return status
}

// One thread row: status dot, key, and queue depth. The whole row tags the
// thread in chat; Stop stays beside it while running. Every row carries an
// icon that opens the thread's own chat without touching its run.
function SubagentRow({
  thread,
  active,
  onTagThread,
  onOpenThread,
  onStop,
}: {
  thread: ThreadView
  active: boolean
  onTagThread?: (key: string) => void
  onOpenThread?: (key: string) => void
  onStop: (key: string) => void
}) {
  const tone = toneFor(thread.status)
  const running = tone === 'working'
  const caption =
    thread.queueDepth > 0 ? `${thread.queueDepth} queued` : labelFor(thread.status)
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
        active ? 'bg-muted' : 'hover:bg-muted/60'
      }`}
    >
      <button
        type="button"
        onClick={() => onTagThread?.(thread.key)}
        aria-label={`Chat with ${thread.key}`}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${toneDot[tone]}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{thread.key}</span>
          <span className="block truncate text-xs text-muted-foreground">{caption}</span>
        </span>
        {running ? (
          <span className="shrink-0 text-xs text-muted-foreground">Running</span>
        ) : null}
      </button>
      {running ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Stop ${thread.key}`}
          onClick={() => onStop(thread.key)}
        >
          <Square className="size-4" aria-hidden />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Open ${thread.key} chat`}
        onClick={() => onOpenThread?.(thread.key)}
      >
        <MessageSquare className="size-4" aria-hidden />
      </Button>
    </div>
  )
}

// The session's subagent threads, docked just above the composer. Stops
// are announced so a background thread is never silent.
export function SubagentsPanel({
  threads,
  taggedKey = null,
  onTagThread,
  onOpenThread,
  onStopThread,
}: {
  threads: ThreadView[]
  taggedKey?: string | null
  onTagThread?: (key: string) => void
  onOpenThread?: (key: string) => void
  onStopThread?: (key: string) => void
}) {
  const subagentList = useExitState()
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const runningThreads = threads.filter((thread) => toneFor(thread.status) === 'working').length

  const toggleLabel =
    runningThreads > 0
      ? `${threads.length} subagents, ${runningThreads} running`
      : `${threads.length} subagents`

  function stop(key: string) {
    onStopThread?.(key)
    setAnnouncement(`${key} stopped.`)
  }

  return (
    <div className="border-t border-border px-4 pt-2">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={toggleLabel}
        aria-expanded={subagentList.open}
        onClick={() => subagentList.set(!subagentList.open)}
      >
        {runningThreads > 0 ? (
          <span aria-hidden className={`size-1.5 rounded-full ${toneDot.working}`} />
        ) : null}
        {threads.length} subagents
        <ChevronDown
          className={`size-4 motion-safe:transition-transform ${subagentList.open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </Button>
      {subagentList.mounted ? (
        <div
          className={`flex max-h-56 scroll-slim origin-top flex-col gap-2 overflow-y-auto py-2 ${subagentList.closing ? popoverExit : popoverEnter}`}
        >
          {threads.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">No subagents yet.</p>
          ) : (
            threads.map((thread) => (
              <SubagentRow
                key={thread.key}
                thread={thread}
                active={thread.key === taggedKey}
                onTagThread={onTagThread}
                onOpenThread={onOpenThread}
                onStop={stop}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
