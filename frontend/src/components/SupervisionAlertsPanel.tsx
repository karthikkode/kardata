import type { SupervisionAlert, SupervisionAlertsPage } from '../data/alerts'
import type { Resource } from '../data/useWorkspace'
import { ResourceNotice } from './workspace-parts'
import { Button } from './ui/button'

const labels: Record<SupervisionAlert['kind'], string> = {
  'closed-owner': 'Owning execution ended',
  'missing-heartbeat': 'Heartbeat needs review',
  'stalled-progress': 'Progress needs review',
  'queue-starvation': 'Queued work needs review',
  'owner-unavailable': 'Workflow status unavailable',
}

function AlertRow({ alert }: { alert: SupervisionAlert }) {
  const href = alert.sectorId ? `/?${new URLSearchParams({
    section: 'SectorChat', sector: alert.sectorId,
    session: alert.sessionId, thread: alert.threadKey,
  })}` : null
  return (
    <li className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{labels[alert.kind]}</p>
        <span className="text-xs text-muted-foreground">
          {alert.state === 'current-warning'
            ? 'Current warning · review paused work'
            : 'Historical observation'}
        </span>
      </div>
      <p className="mt-1 break-all text-xs text-muted-foreground">Thread {alert.threadKey}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <time dateTime={alert.at}>{new Date(alert.at).toLocaleString()}</time>
        {' · '}Recorded action: {alert.response === 'park' ? 'Park for review' : 'Observe'}
      </p>
      {href ? (
        <a className="mt-2 inline-block text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={href}>
          Review conversation
        </a>
      ) : (
        <p className="mt-2 break-all text-xs text-muted-foreground">
          Open “{alert.sessionTitle}” in the chat session picker and match session {alert.sessionId}. Use its agent directory for child threads.
        </p>
      )}
    </li>
  )
}

export function SupervisionAlertsPanel({ resource, viewingOlder, onOlder, onLatest }: {
  resource: Resource<SupervisionAlertsPage>
  viewingOlder: boolean
  onOlder(): void
  onLatest(): void
}) {
  const items = resource.status === 'ready' ? resource.data?.items : undefined
  return (
    <section aria-label="Supervision alerts" className="mb-6 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Supervision alerts</h2>
        {viewingOlder ? <Button variant="ghost" size="sm" onClick={onLatest}>Latest alerts</Button> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Durable observations for your sessions. Historical observations do not establish that work is currently unhealthy.
      </p>
      <div className="mt-3"><ResourceNotice resource={resource} label="Alerts" /></div>
      {items ? items.length ? (
        <ul className="space-y-3">{items.map((alert) => <AlertRow key={alert.seq} alert={alert} />)}</ul>
      ) : (
        <p className="rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
          No supervision observations recorded for your sessions.
        </p>
      ) : null}
      {resource.status === 'ready' && resource.data?.nextBeforeSeq ? (
        <Button className="mt-3" variant="outline" size="sm" onClick={onOlder}>Older alerts</Button>
      ) : null}
    </section>
  )
}
