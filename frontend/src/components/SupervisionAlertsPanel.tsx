import { useState } from 'react'
import type { SupervisionAlert, SupervisionAlertsPage } from '../data/alerts'
import type { Resource } from '../data/useWorkspace'
import { Icons } from '@/lib/icons'
import { relativeAge } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BodySm, Caption, Description } from './text'
import { ResourceState, SectionCard } from './shells'
import { Button } from './ui/button'
import { List, ListRow } from './ui/list'
import { TabsList, TabsRoot, TabsTab } from './ui/tabs'

const labels: Record<SupervisionAlert['kind'], string> = {
  'closed-owner': 'Owning execution ended',
  'missing-heartbeat': 'Heartbeat needs review',
  'stalled-progress': 'Progress needs review',
  'queue-starvation': 'Queued work needs review',
  'owner-unavailable': 'Workflow status unavailable',
}

function recordedAction(response: SupervisionAlert['response']): string {
  return response === 'park' ? 'Parked for review' : 'Observed'
}

function AlertRow({ alert, onOpen }: { alert: SupervisionAlert; onOpen(alert: SupervisionAlert): void }) {
  const current = alert.state === 'current-warning'
  return (
    <ListRow density="comfortable">
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          current ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground',
        )}
      >
        {current ? <Icons.alertWarning className="size-4" /> : <Icons.history className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <BodySm as="span" className="block truncate font-medium text-foreground">
          {labels[alert.kind]}
        </BodySm>
        <Description as="span" className="block truncate">
          Session {alert.sessionTitle} · {recordedAction(alert.response)}
        </Description>
        {alert.sectorId ? null : (
          <Description as="span" className="mt-0.5 block">
            Open “{alert.sessionTitle}” in the chat session picker and match session {alert.sessionId}.
          </Description>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Caption as="span" title={new Date(alert.at).toLocaleString()} className="tabular-nums">
          {relativeAge(alert.at)}
        </Caption>
        {alert.sectorId ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(alert)}>
            Open conversation
          </Button>
        ) : null}
      </span>
    </ListRow>
  )
}

export function SupervisionAlertsPanel({ resource, viewingOlder, onOlder, onLatest, onOpenConversation }: {
  resource: Resource<SupervisionAlertsPage>
  viewingOlder: boolean
  onOlder(): void
  onLatest(): void
  onOpenConversation(alert: SupervisionAlert): void
}) {
  const [tab, setTab] = useState<'current' | 'history'>(viewingOlder ? 'history' : 'current')
  // Paging to an older page moves the eye to History; Current always
  // reads the latest page (selectTab below resets it).
  if (viewingOlder && tab === 'current') setTab('history')
  const items = resource.status === 'ready' ? (resource.data?.items ?? []) : undefined
  const visible = tab === 'current' ? items?.filter((alert) => alert.state === 'current-warning') : items
  function selectTab(next: string) {
    const value = next === 'history' ? 'history' : 'current'
    setTab(value)
    // Current always reads the latest page; History keeps paging older.
    if (value === 'current' && viewingOlder) onLatest()
  }
  return (
    <SectionCard
      title="Alerts"
      actions={(
        <TabsRoot value={tab} onValueChange={(value) => selectTab(String(value))}>
          <TabsList variant="segmented" aria-label="Alert scope">
            <TabsTab value="current">Current</TabsTab>
            <TabsTab value="history">History</TabsTab>
          </TabsList>
        </TabsRoot>
      )}
      footer={resource.status === 'ready' && resource.data?.nextBeforeSeq ? (
        <Button type="button" variant="outline" size="sm" onClick={onOlder}>Older alerts</Button>
      ) : undefined}
    >
      <Description className="pb-2">
        Durable observations for your sessions. Historical observations do not establish that work is currently unhealthy.
      </Description>
      <ResourceState
        resource={resource}
        label="Alerts"
        deniedBody="Alerts are not shared with this key. Ask an owner for access, then try again."
        emptyKind={visible?.length === 0 ? 'first' : null}
        icon={tab === 'current' ? <Icons.alertSuccess aria-hidden /> : undefined}
        iconClassName={tab === 'current' ? 'bg-success-soft [&_svg]:text-success' : undefined}
        emptyTitle={tab === 'current' ? 'All clear' : 'No supervision observations recorded for your sessions.'}
        emptyBody={tab === 'current' ? 'No current warnings for your sessions.' : undefined}
      >
        {visible?.length ? (
          <List aria-label={tab === 'current' ? 'Current warnings' : 'Alert history'}>
            {visible.map((alert) => <AlertRow key={alert.seq} alert={alert} onOpen={onOpenConversation} />)}
          </List>
        ) : null}
      </ResourceState>
    </SectionCard>
  )
}
