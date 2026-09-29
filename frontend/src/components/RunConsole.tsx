// Run console: the live operations view for a sector research run.
// Timeline from the sector detail (already polled while running);
// steer targets load in their own state block so a threads failure
// degrades to an inline note instead of hiding the timeline. Dispatch
// rides the existing approver command paths behind an explicit review.
import { useEffect, useState } from 'react'
import {
  apiErrorStatus,
  listSessions,
  listThreads,
  sendThreadText,
  steerThread,
  type SectorActivityEntry,
  type SectorResearch,
  type StagingConfig,
  type ThreadView,
} from '../data/staging-api'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { SkeletonRows } from './research-parts'

type ThreadsState =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'failed' }
  | { status: 'ready'; threads: ThreadView[] }

export function RunConsole({
  config,
  sector,
  activity,
  activityTotal,
}: {
  config: StagingConfig | null
  sector: SectorResearch
  activity: SectorActivityEntry[]
  activityTotal: number
}) {
  const [threads, setThreads] = useState<ThreadsState>({ status: 'loading' })
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'send' | 'steer'>('steer')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const loadKey = config ? `${config.baseUrl} ${config.apiKey} ${sector.id}` : null
  const [activeKey, setActiveKey] = useState<string | null>(null)
  if (activeKey !== loadKey) {
    setActiveKey(loadKey)
    setThreads({ status: 'loading' })
    setTarget('')
    setResult(null)
    setFailure(null)
  }
  useEffect(() => {
    if (!config) return
    let live = true
    // Every chat in the sector pool contributes its threads: the pinned
    // research session, manual chats, and their subagents. Capped, since
    // the console watches work, it never pages a fleet.
    listSessions(config, sector.id)
      .then((sessions) =>
        Promise.all(sessions.slice(0, 20).map((session) => listThreads(config, session.id).catch(() => [] as ThreadView[]))),
      )
      .then(
        (groups) => {
          if (live) setThreads({ status: 'ready', threads: groups.flat() })
        },
        (error: unknown) => {
          if (!live) return
          setThreads({ status: apiErrorStatus(error) === 'denied' ? 'denied' : 'failed' })
        },
      )
    return () => {
      live = false
    }
  }, [config, sector.id])
  if (!config) return null
  return (
    <section aria-label={`Run console for ${sector.name}`} className="rounded-xl border border-border bg-background px-4 py-3">
      <h2 className="text-base font-semibold">Run console</h2>
      <div className="mt-3 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Timeline</h3>
          {activity.length ? (
            <ol className="mt-2 space-y-1">
              {activity.map((entry, index) => (
                <li key={`${entry.seq}-${index}`} className="text-sm text-muted-foreground">
                  {entry.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No run activity yet.</p>
          )}
          {activityTotal > activity.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing {activity.length} of {activityTotal}
            </p>
          ) : null}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Steer</h3>
          {threads.status === 'loading' ? (
            <div className="mt-2">
              <SkeletonRows label="Steer targets are loading" />
            </div>
          ) : threads.status === 'denied' ? (
            <p className="mt-2 text-sm text-muted-foreground">Steer targets are not shared with this key.</p>
          ) : threads.status === 'failed' ? (
            <p className="mt-2 text-sm text-muted-foreground">Steer targets did not load. The timeline above still stands.</p>
          ) : threads.threads.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No steerable threads yet. Start a chat or a run first.</p>
          ) : (
            <div className="mt-2 grid max-w-md gap-2">
              <label htmlFor="run-console-target" className="mb-1 block text-sm font-medium">
                Target
              </label>
              <select
                id="run-console-target"
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value)
                  setConfirming(false)
                  setResult(null)
                  setFailure(null)
                }}
              >
                <option value="">Choose a thread…</option>
                {threads.threads.map((thread) => (
                  <option key={thread.key} value={thread.key}>
                    {thread.kind === 'subagent' ? `Subagent ${thread.key}` : `Session ${thread.key}`}
                  </option>
                ))}
              </select>
              <div role="group" aria-label="Steer mode" className="flex gap-2">
                {(['send', 'steer'] as const).map((choice) => (
                  <Button
                    key={choice}
                    type="button"
                    variant={mode === choice ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={mode === choice}
                    onClick={() => {
                      setMode(choice)
                      setConfirming(false)
                    }}
                  >
                    {choice === 'send' ? 'Send' : 'Steer'}
                  </Button>
                ))}
              </div>
              <label htmlFor="run-console-text" className="mb-1 block text-sm font-medium">
                Direction
              </label>
              <Input
                id="run-console-text"
                placeholder="Redirect toward pricing evidence"
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setConfirming(false)
                }}
              />
              {failure ? (
                <p role="alert" className="text-sm text-muted-foreground">
                  {failure}
                </p>
              ) : null}
              {result ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {result}
                </p>
              ) : null}
              {confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm">
                    {mode === 'send' ? 'Send' : 'Steer'} {target || '…'}: {text || '…'}
                  </p>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={sending || !target || !text.trim()}
                    onClick={() => {
                      if (!config || sending) return
                      setSending(true)
                      setFailure(null)
                      const call =
                        mode === 'send'
                          ? sendThreadText(config, target, text.trim())
                          : steerThread(config, target, text.trim())
                      call.then(
                        (accepted) => {
                          setSending(false)
                          setConfirming(false)
                          setResult(
                            accepted.state === 'missed_steer'
                              ? 'Nothing was listening: recorded as missed steer.'
                              : 'Accepted.',
                          )
                        },
                        (error: unknown) => {
                          setSending(false)
                          setFailure(error instanceof Error ? error.message : 'Steer failed.')
                        },
                      )
                    }}
                  >
                    {sending ? 'Sending…' : 'Confirm'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!target || !text.trim()}
                  onClick={() => setConfirming(true)}
                >
                  Review
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
