// Session subagent threads, docked just above the composer. Rows come
// from the backend thread list: status dot, humanized name, and one
// status caption. Stopping cancels the thread's run through the parent.
// There is no local launching or staged progress: every row on screen
// was served by the API.
import { useState } from 'react'
import { Icons } from '@/lib/icons'
import { popoverEnter, popoverExit, useExitState } from '@/lib/motion'
import type { ThreadView } from '../data/staging-api'
import { toneDot } from './StatusPill'
import { Button } from './ui/button'
import { IconButton } from './IconButton'
import { List, ListRow } from './ui/list'

function toneFor(status: string): 'working' | 'ok' | 'failed' | 'idle' {
  if (/running/i.test(status)) return 'working'
  if (/done|finished|complete/i.test(status)) return 'ok'
  if (/fail|error/i.test(status)) return 'failed'
  return 'idle'
}

function labelFor(status: string): string {
  if (/running/i.test(status)) return 'Running'
  if (/paused/i.test(status)) return 'Paused'
  if (/done|finished|complete/i.test(status)) return 'Done'
  if (/fail|error/i.test(status)) return 'Failed'
  if (/stop|cancel/i.test(status)) return 'Stopped'
  return status
}

// Display name for a thread row: the backend title when set, otherwise a
// positional fallback. Raw `agent:...` keys never render as text; they
// survive only in the row tooltip.
function displayName(thread: ThreadView, index: number): string {
  return thread.name?.trim() ? thread.name : `Subagent ${index + 1}`
}

// One thread row: status dot, humanized name, and one status caption. The
// row uses the shared ListRow recipe (plan 2.5.1) as a non-interactive
// container: the tag button and the trailing icons stay separate controls
// because buttons cannot nest. Callbacks still travel by thread key.
function SubagentRow({
  thread,
  index,
  active,
  onTagThread,
  onOpenThread,
  onStop,
  onPause,
  onResume,
}: {
  thread: ThreadView
  index: number
  active: boolean
  onTagThread?: (key: string) => void
  onOpenThread?: (key: string) => void
  onStop: (key: string) => void
  onPause?: (key: string) => void
  onResume?: (key: string) => void
}) {
  const tone = toneFor(thread.status)
  const running = tone === 'working'
  const paused = /paused/i.test(thread.status)
  const name = displayName(thread, index)
  const caption =
    thread.queueDepth > 0 ? `${thread.queueDepth} queued` : labelFor(thread.status)
  return (
    <ListRow selected={active} density="dense">
      <button
        type="button"
        onClick={() => onTagThread?.(thread.key)}
        aria-label={`Chat with ${name}`}
        title={thread.key}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${toneDot[tone]}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{caption}</span>
        </span>
      </button>
      {running && onPause ? (
        <IconButton label={`Pause ${name}`} size="icon-sm" type="button" onClick={() => onPause(thread.key)}
        >
          <Icons.pause className="size-4" aria-hidden />
        </IconButton>
      ) : null}
      {paused && onResume ? (
        <IconButton label={`Resume ${name}`} size="icon-sm" type="button" onClick={() => onResume(thread.key)}
        >
          <Icons.play className="size-4" aria-hidden />
        </IconButton>
      ) : null}
      {running ? (
        <IconButton label={`Stop ${name}`} size="icon-sm" type="button" onClick={() => onStop(thread.key)}
        >
          <Icons.stopSquare className="size-4" aria-hidden />
        </IconButton>
      ) : null}
      <IconButton label={`Open ${name} chat`} size="icon-sm" type="button" onClick={() => onOpenThread?.(thread.key)}
      >
        <Icons.chatMessage className="size-4" aria-hidden />
      </IconButton>
    </ListRow>
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
  onPauseThread,
  onResumeThread,
}: {
  threads: ThreadView[]
  taggedKey?: string | null
  onTagThread?: (key: string) => void
  onOpenThread?: (key: string) => void
  onStopThread?: (key: string) => void
  onPauseThread?: (key: string) => void
  onResumeThread?: (key: string) => void
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
    const at = threads.findIndex((thread) => thread.key === key)
    const thread = at >= 0 ? threads[at]! : null
    setAnnouncement(`${thread ? displayName(thread, at) : key} stopped.`)
  }

  function pause(key: string) {
    onPauseThread?.(key)
    const at = threads.findIndex((thread) => thread.key === key)
    const thread = at >= 0 ? threads[at]! : null
    setAnnouncement(`${thread ? displayName(thread, at) : key} paused.`)
  }

  function resume(key: string) {
    onResumeThread?.(key)
    const at = threads.findIndex((thread) => thread.key === key)
    const thread = at >= 0 ? threads[at]! : null
    setAnnouncement(`${thread ? displayName(thread, at) : key} resumed.`)
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
        <Icons.chevronDown
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
            <List className="gap-2" aria-label="Subagent threads">
              {threads.map((thread, index) => (
                <SubagentRow
                  key={thread.key}
                  thread={thread}
                  index={index}
                  active={thread.key === taggedKey}
                  onTagThread={onTagThread}
                  onOpenThread={onOpenThread}
                  onStop={stop}
                  onPause={onPauseThread ? pause : undefined}
                  onResume={onResumeThread ? resume : undefined}
                />
              ))}
            </List>
          )}
        </div>
      ) : null}
    </div>
  )
}
