// Sector workspace (WS-01..10, SA, SO): session rail, conversation
// centre with Chat/Plan tabs, files plus global-context rail. Rails are
// sidebar surfaces; the centre carries one h1 per view. Data stays in
// the model; this file owns layout, hierarchy, and state copy only.
import { FileProcessingRetry } from './FileProcessingRetry'
import type { LibraryFile } from '../data/useFiles'
import { useWorkReview } from '../data/useWorkReview'
import { useEffect, useId, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { SectorWorkspaceModel } from '../data/sector-workspace'
import type { ResearchState, SectorDetail } from '../data/useSectors'
import type { StagingConfig } from '../data/useApi'
import { formatCount, formatFullDate, relativeAge } from '../lib/format'
import { researchStateLabel, threadStatusLabel } from '../lib/labels'
import { rowEnter, staggerDelay } from '../lib/motion'
import { notify } from '../lib/toast'
import { useTheme } from '../lib/theme'
import { AnimatePresence, m } from 'motion/react'
import { groupMessageSegments } from './chat/messages'
import { AgentBubble, UserBubble, useChatStick } from './chat-parts'
import { Composer } from './chat/Composer'
import { ConversationEmpty } from './chat/ConversationEmpty'
import { ReasoningDisclosure, useReasoningOpen } from './chat/ReasoningDisclosure'
import { ThinkingRow } from './chat/ThinkingRow'
import { ToolActivity } from './chat/ToolActivity'
import { ThreadPrimitive } from '@assistant-ui/react'
import { AssistantRuntimeAdapter } from './chat/AssistantRuntimeAdapter'
import { toThreadSegments } from './chat/assistantAdapter'
import { Markdown } from './Markdown'
import { SectorFilePreview } from './SectorFilePreview'
import { subagentDisplayName } from './SubagentsPanel'
import { ResearchPlanTab, type ResearchActions } from './plan/PlanTab'
import { ModelToolbar } from './ModelToolbar'
import { StateBadge } from './research-parts'
import { GlobalContextPanel } from './global-context-panel'
import { LocalContextEditor } from './local-context-editor'
import { ResourceNotice, WorkspaceOverlay } from './workspace-parts'
import { WorkspaceFiles } from './workspace-files'
import { ConversationComposer, ResourceState, SearchField } from './shells'
import { BodySm, Caption, CardTitle, Description, Label, Overline, WorkspaceTitle } from './text'
import { focusRingInset } from '@/lib/interaction'
import { popoverEnter } from '@/lib/motion'
import { ThemeMenu } from './ThemeMenu'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ConfirmAction } from './ui/alert-dialog'
import { List, ListRow, listRowClassName } from './ui/list'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from './ui/menu'
import { SwitchRoot } from './ui/switch'
import { TabsList, TabsPanel, TabsRoot, TabsTab } from './ui/tabs'
import { ExecutionInspector } from './ExecutionInspector'
import { IconButton } from './IconButton'

// Arrow-key navigation for the workspace tablists (WAI-APG automatic
// activation): focus and selection move together. Tab bodies stay mounted
// exactly as before, so drafts and scroll survive leaving Chat.
export function activateNeighbor(
  event: React.KeyboardEvent,
  values: string[],
  current: string,
  activate: (value: string) => void,
  scope: string,
) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = values.indexOf(current)
  const next =
    event.key === 'Home'
      ? values[0]
      : event.key === 'End'
        ? values[values.length - 1]
        : values[(index + (event.key === 'ArrowRight' ? 1 : values.length - 1)) % values.length]
  activate(next)
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLButtonElement>(`[data-tab-scope="${scope}"][data-tab-value="${next}"]`)
      ?.focus()
  })
}

const WORKSPACE_RAIL_STORAGE_KEY = 'kardata-workspace-rail'

function readRailHidden(): boolean {
  try {
    return window.localStorage.getItem(WORKSPACE_RAIL_STORAGE_KEY) === 'hidden'
  } catch {
    return false
  }
}

const SKELETON_WIDTHS = ['64%', '48%', '72%', '56%', '64%']

function SessionListSkeleton() {
  return (
    <div className="flex min-w-0 flex-col" aria-hidden>
      {SKELETON_WIDTHS.map((width, index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 px-2">
          <div className="size-4 shrink-0 rounded-sm bg-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-3 rounded-sm bg-muted" style={{ width }} />
            <div className="h-3 w-1/3 rounded-sm bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Lifecycle button (WS-07): the labelled next step for research
 * sessions. Advancing steps are primary, Pause is secondary; planning,
 * queued and complete show no action (the backend cannot pause them). */
export function LifecycleButton({ state, actions, onReviewPlan }: { state: ResearchState; actions: ResearchActions; onReviewPlan(): void }) {
  if (state === 'planned') {
    return (
      <Button type="button" variant="primary" size="sm" pending={actions.busy} onClick={onReviewPlan}>
        <Icons.plan aria-hidden />
        Review plan
      </Button>
    )
  }
  const step =
    state === 'draft' || state === 'failed'
      ? { label: 'Create plan', click: actions.plan, icon: Icons.plan, variant: 'primary' as const }
      : state === 'approved'
        ? { label: 'Start research', click: actions.start, icon: Icons.play, variant: 'primary' as const }
        : state === 'running'
          ? { label: 'Pause', click: actions.pause, icon: Icons.pause, variant: 'secondary' as const }
          : state === 'paused'
            ? { label: 'Resume', click: actions.resume, icon: Icons.play, variant: 'primary' as const }
            : null
  if (!step) return null
  const StepIcon = step.icon
  return (
    <Button type="button" variant={step.variant} size="sm" pending={actions.busy} onClick={step.click}>
      <StepIcon aria-hidden />
      {step.label}
    </Button>
  )
}

export function SectorWorkspace({ sector, model, config, actions, onBack, initialView }: {
  sector: SectorDetail; model: SectorWorkspaceModel; config: StagingConfig; actions: ResearchActions; onBack(): void; initialView?: 'chat' | 'plan'
}) {
  const workReview = useWorkReview(config, model.progress)
  const [retryFile, setRetryFile] = useState<LibraryFile | null>(null)
  const [group, setGroup] = useState<'research' | 'normal'>('research')
  const [tab, setTab] = useState<'chat' | 'plan'>(initialView ?? 'chat')
  const [navOpen, setNavOpen] = useState(false), [resourcesOpen, setResourcesOpen] = useState(false), [contextOpen, setContextOpen] = useState(false), [directory, setDirectory] = useState(false), [spawnOpen, setSpawnOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [stopTarget, setStopTarget] = useState<{ name: string; stop: () => Promise<boolean> } | null>(null)
  const [railHidden, setRailHidden] = useState(readRailHidden)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [sessionQuery, setSessionQuery] = useState(''), [sessionLimit, setSessionLimit] = useState(50)
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()
  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_RAIL_STORAGE_KEY, railHidden ? 'hidden' : 'shown')
    } catch {
      // Storage unavailable: the choice still applies for this session.
    }
  }, [railHidden])
  const selected = model.selected
  const [seenSession, setSeenSession] = useState(selected?.id)
  if (selected && seenSession !== selected.id) { setSeenSession(selected.id); setGroup(selected.kind === 'research' ? 'research' : 'normal') }
  const normal = model.sessions.data?.filter((session) => session.kind !== 'research') ?? []
  const research = model.sessions.data?.find((session) => session.kind === 'research')
  const listed = (group === 'research' ? research ? [research] : [] : normal).filter((session) => session.title.toLowerCase().includes(sessionQuery.toLowerCase()))
  const children = model.threads.data?.filter((thread) => thread.kind === 'subagent') ?? []
  const busy = Boolean(model.operation)
  const blockingError = model.error ?? actions.error
  // Row enter animation (WS-05): ids present on first paint never
  // animate; rows arriving later (a created chat) animate once on
  // mount. The snapshot is render-pure state and the enter animation
  // is one-shot, so the class persisting on new rows is harmless.
  const [initialSessionIds] = useState(() => new Set(listed.map((session) => session.id)))

  function switchGroup(kind: 'research' | 'normal'): void {
    setGroup(kind)
    setSessionQuery('')
    setSessionLimit(50)
    const first = kind === 'research' ? research : normal[0]
    if (first) model.openSession(first.id)
  }

  function openRename(session: { id: string; title: string }): void {
    if (selected?.id !== session.id) model.openSession(session.id)
    setRenameTarget({ id: session.id, title: session.title })
  }

  function openDelete(session: { id: string; title: string }): void {
    if (selected?.id !== session.id) model.openSession(session.id)
    setDeleteTarget({ id: session.id, title: session.title })
  }

  const sessionsEmptyKind = model.sessions.status === 'ready' && listed.length === 0 ? (sessionQuery ? 'filtered' as const : group === 'normal' ? 'first' as const : null) : null

  const sessionRail = <div className="flex h-full min-h-0 flex-col">
    <div className="px-3 pt-3">
      <div className="flex items-center gap-2">
        <IconButton label="Back to sector summary" size="icon-sm" onClick={onBack}><Icons.back className="size-4" aria-hidden /></IconButton>
        <CardTitle as="span" title={sector.name} className="min-w-0 flex-1 truncate">{sector.name}</CardTitle>
      </div>
      <div className="mt-1 flex items-center gap-1.5 pl-10">
        <StateBadge state={sector.state} />
        <Caption as="span" className="tabular-nums">{formatCount(sector.companiesFound)} {sector.companiesFound === 1 ? 'company' : 'companies'}</Caption>
      </div>
    </div>
    <div className="px-3 pt-3">
      <TabsRoot value={group} onValueChange={(value) => switchGroup(value as 'research' | 'normal')}>
        <TabsList variant="segmented" aria-label="Session types" className="w-full">
          <TabsTab value="research" className="flex-1">Research</TabsTab>
          <TabsTab value="normal" className="flex-1"><span className="tabular-nums">{`Chats (${formatCount(normal.length)})`}</span></TabsTab>
        </TabsList>
      </TabsRoot>
    </div>
    {group === 'normal' ? (
      <div className="px-3 pt-3">
        <Button type="button" variant="secondary" pending={model.operation === 'create'} className="w-full" onClick={() => void model.createChat()}>
          <Icons.plus aria-hidden />
          New chat
        </Button>
      </div>
    ) : null}
    {normal.length > 5 && group === 'normal' ? <div className="px-3 pt-3"><SearchField value={sessionQuery} onChange={(value) => { setSessionQuery(value); setSessionLimit(50) }} label="Search chats" placeholder="Search chats" /></div> : null}
    <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <ResourceState
        resource={model.sessions}
        label="Sessions"
        skeleton={<SessionListSkeleton />}
        compact
        emptyKind={sessionsEmptyKind}
        emptyTitle="No chats yet"
        emptyBody="Start a chat to brainstorm alongside research."
        emptyAction={<Button type="button" variant="link" size="sm" onClick={() => void model.createChat()}>Start a chat</Button>}
        onClearFilter={() => setSessionQuery('')}
        clearLabel="Clear search"
      >
        <List aria-label={group === 'research' ? 'Research sessions' : 'Chat sessions'}>
          {listed.slice(0, sessionLimit).map((session) => {
            const isActive = selected?.id === session.id
            const isChat = session.kind !== 'research'
            const isNew = !initialSessionIds.has(session.id)
            const SessionIcon = session.kind === 'research' ? Icons.researchSession : Icons.chatSession
            return (
              <li key={session.id} className="group relative flex min-w-0 flex-col">
                <button
                  type="button"
                  data-list-row=""
                  data-selected={isActive || undefined}
                  aria-label={`Open ${session.title}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => { model.openSession(session.id); setTab('chat'); setNavOpen(false) }}
                  className={cn(listRowClassName({ density: 'comfortable' }), 'items-start', isChat && 'pr-10', isNew && rowEnter)}
                >
                  <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                    <SessionIcon aria-hidden className={cn('size-4 text-muted-foreground transition-colors group-hover:text-foreground', isActive && 'text-foreground')} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <BodySm as="span" title={session.title} className={cn('block truncate', isActive && 'font-medium')}>{session.title}</BodySm>
                    {session.kind === 'research' ? (
                      <Caption as="span" className="mt-0.5 block truncate">{researchStateLabel(sector.state)}</Caption>
                    ) : (
                      <Caption as="span" title={formatFullDate(session.updatedAt)} className="mt-0.5 block truncate tabular-nums">{relativeAge(session.updatedAt)}</Caption>
                    )}
                  </span>
                </button>
                {isChat ? (
                  <MenuRoot>
                    <MenuTrigger
                      render={
                        <IconButton
                          label={`Options for ${session.title}`}
                          size="icon-sm"
                          className="absolute top-1/2 right-2 -translate-y-1/2 transition-opacity duration-120 pointer-coarse:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
                        >
                          <Icons.moreActions className="size-4" aria-hidden />
                        </IconButton>
                      }
                    />
                    <MenuPopup>
                      <MenuItem onClick={() => openRename(session)}>
                        <Icons.edit aria-hidden />
                        Rename
                      </MenuItem>
                      <MenuItem onClick={() => openDelete(session)} className="text-danger">
                        <Icons.delete aria-hidden />
                        Delete
                      </MenuItem>
                    </MenuPopup>
                  </MenuRoot>
                ) : null}
              </li>
            )
          })}
        </List>
        {listed.length > sessionLimit ? (
          <div className="px-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setSessionLimit((limit) => limit + 50)}>Show more ({sessionLimit} of {listed.length})</Button>
          </div>
        ) : null}
      </ResourceState>
    </div>
    <div className="flex items-center justify-start border-t border-border-subtle px-3 py-2">
      <ThemeMenu preference={themePreference} onPreference={setThemePreference} side="right" />
    </div>
  </div>
  const resourceRail = <div className="flex h-full min-h-0 flex-col divide-y divide-border-subtle"><WorkspaceFiles resource={model.files} busy={busy} onUpload={(file) => void model.upload(file)} onHide={(id, hidden) => void model.hideFile(id, hidden)} onInclude={(id) => { void (async () => { if (await model.includeFile(id)) notify.success(`Summarizing ${model.files.data?.find((file) => file.id === id)?.filename ?? 'file'} for global context`) })() }} onRemove={(id) => { void (async () => { const name = model.files.data?.find((file) => file.id === id)?.filename ?? model.global.data?.files.find((block) => block.fileId === id)?.filename ?? 'file'; if (await model.removeFile(id)) notify.success(`Removed ${name} from global context`) })() }} onPreview={model.previewFile} onRetry={setRetryFile} /><GlobalContextPanel preview={model.preview} onReview={model.reviewProposal} resource={model.global} busy={busy} error={model.error} onSave={model.saveGlobal} onDecision={model.decide} onSummarize={(id) => void model.summarizeFile(id)} onRemove={(id) => { void (async () => { const name = model.global.data?.files.find((block) => block.fileId === id)?.filename ?? 'file'; if (await model.removeFile(id)) notify.success(`Removed ${name} from global context`) })() }} onCompact={() => { void (async () => { if (await model.compactGlobal()) notify.success('Compacting global context') })() }} onRestore={async (version) => { const ok = await model.restoreGlobal(version); if (ok) notify.success(`Global context restored to v${version}`); return ok }} onRewrite={(instruction) => model.startRewrite(instruction)} onCopied={() => notify.success('Copied')} /></div>
  const isResearchView = selected?.kind === 'research' && !model.child
  const planLatest = model.plan.data?.latest
  const planApproved = planLatest != null && model.plan.data?.approvedVersion === planLatest.version
  const subagentStrip = <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 sm:px-6"><Icons.agents className="size-4 shrink-0 text-muted-foreground" aria-hidden /><Caption as="span" className="shrink-0">Subagents</Caption>{children.length ? <div className="flex min-w-60 flex-1 flex-wrap items-center gap-1">{children.slice(0, 3).map((child, index) => {
            const name = subagentDisplayName(child, index)
            const childId = child.key.startsWith('agent:') ? child.key.slice('agent:'.length) : child.key
            const paused = child.status === 'PAUSED'
            return (
              <span key={child.key} className={cn('flex min-w-36 max-w-52 flex-1 items-center', rowEnter)} style={{ animationDelay: `${staggerDelay(index)}s` }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => model.openThread(child.key)} title={child.key} className="min-w-0 flex-1"><span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', child.status === 'RUNNING' ? 'bg-success motion-safe:animate-pulse' : 'bg-muted-foreground')} /><span className="truncate">{name}</span></Button>
                {paused ? <Badge tone="warning">Paused</Badge> : null}
                {paused
                  ? <IconButton label={`Resume ${name}`} size="icon-sm" onClick={() => void model.resumeSubagent(childId)}><Icons.play className="size-3.5" aria-hidden /></IconButton>
                  : child.status === 'RUNNING' ? <IconButton label={`Pause ${name}`} size="icon-sm" onClick={() => void model.pauseSubagent(childId)}><Icons.pause className="size-3.5" aria-hidden /></IconButton> : null}
                {child.status === 'RUNNING' ? <IconButton label={`Stop ${name}`} size="icon-sm" onClick={() => setStopTarget({ name, stop: () => model.stopSubagent(childId) })} className="text-danger hover:text-danger"><Icons.stopRun className="size-3.5" aria-hidden /></IconButton> : null}
              </span>
            )
          })}</div> : <Caption as="span" className="min-w-0 flex-1 text-muted-foreground">No subagents yet.</Caption>}{children.length ? <Button type="button" variant="link" size="sm" className="shrink-0" onClick={() => setDirectory(true)}>View all {children.length}</Button> : null}<Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => setSpawnOpen(true)}>New subagent</Button></div>
  const errorNotice = blockingError && dismissedError !== blockingError ? <div className="shrink-0 border-b border-border-subtle px-4 py-2 sm:px-6"><div role="alert" className="flex gap-2 rounded-md border border-danger-border bg-danger-soft p-3"><span className="flex h-5 shrink-0 items-center"><Icons.alertError aria-hidden className="size-4 text-danger" /></span><BodySm as="span" className="min-w-0 flex-1">{blockingError}</BodySm><IconButton label="Dismiss error" size="icon-sm" onClick={() => setDismissedError(blockingError)}><Icons.deny className="size-4" aria-hidden /></IconButton></div></div> : null
  return <div className="flex h-dvh min-h-0 overflow-hidden bg-background">
    <aside aria-label="Sector sessions" className="hidden min-h-0 w-70 shrink-0 border-r border-border-subtle bg-sidebar md:block">{sessionRail}</aside>
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-6">
        <IconButton label="Open sessions" size="icon" className="md:hidden" onClick={() => setNavOpen(true)}><Icons.menu className="size-4" aria-hidden /></IconButton>
        {model.child ? <IconButton label="Back to parent conversation" size="icon" onClick={() => selected && model.openThread(selected.id)}><Icons.back className="size-4" aria-hidden /></IconButton> : null}
        <div className="min-w-0 flex-1">
          <WorkspaceTitle as="h1" className="truncate">{model.child ? model.child.name ?? 'Research agent' : selected?.title ?? 'Sector workspace'}</WorkspaceTitle>
          {model.child ? (
            <Caption className="mt-0.5 truncate">Subagent of Research</Caption>
          ) : selected?.kind === 'research' ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <StateBadge state={sector.state} />
              <Caption as="span" className="truncate">{planLatest ? `Plan v${planLatest.version}${planApproved ? ' approved' : ''}` : model.plan.status === 'ready' ? 'No plan yet' : null}</Caption>
            </span>
          ) : selected ? (
            <Caption className="mt-0.5 truncate">Chat · Updated {relativeAge(selected.updatedAt)}</Caption>
          ) : null}
        </div>
        {selected?.kind === 'research' && !model.child ? <LifecycleButton state={sector.state} actions={actions} onReviewPlan={() => setTab('plan')} /> : null}
        {model.chat.busy ? <IconButton label="Stop agent" size="icon" disabled={Boolean(model.operation)} onClick={() => setStopTarget({ name: model.child ? model.child.name ?? 'Research agent' : selected?.title ?? 'this conversation', stop: () => model.stop() })} className="text-danger hover:text-danger"><Icons.stopRun className="size-4" aria-hidden /></IconButton> : null}
        <IconButton label={railHidden ? 'Show files and context' : 'Hide files and context'} size="icon" className="hidden min-[1281px]:inline-flex" onClick={() => setRailHidden((value) => !value)}>{railHidden ? <Icons.railShow className="size-4" aria-hidden /> : <Icons.railHide className="size-4" aria-hidden />}</IconButton>
        <IconButton label="Open files and global context" size="icon" className="min-[1281px]:hidden" onClick={() => setResourcesOpen(true)}><Icons.folderOpen className="size-4" aria-hidden /></IconButton>
        <MenuRoot>
          <MenuTrigger render={<IconButton label="Conversation options" size="icon" disabled={!selected}><Icons.moreActions className="size-4" aria-hidden /></IconButton>} />
          <MenuPopup>
            <MenuItem onClick={() => { if (selected) openRename({ id: selected.id, title: selected.title }) }}><Icons.edit aria-hidden />Rename</MenuItem>
            <MenuItem onClick={() => setContextOpen(true)}><Icons.localContext aria-hidden />Local context</MenuItem>
            <MenuItem onClick={() => model.inspectExecution()}><Icons.executionRecords aria-hidden />Execution records</MenuItem>
            {selected ? (
              <div className="flex min-h-9 items-center gap-2 px-2 py-1">
                <span id="use-global-context-label" className="min-w-0 flex-1 text-left text-ui">Use global context</span>
                <SwitchRoot checked={selected.useGlobalContext !== false} disabled={Boolean(model.operation)} aria-labelledby="use-global-context-label" onCheckedChange={(checked) => { void (async () => { if (await model.setUseGlobalContext(checked)) notify.success(`Global context ${checked ? 'on' : 'off'} for this chat`) })() }} />
              </div>
            ) : null}
            {selected && selected.kind !== 'research' ? <MenuItem onClick={() => { if (selected) openDelete({ id: selected.id, title: selected.title }) }} className="text-danger"><Icons.delete aria-hidden />Delete</MenuItem> : null}
          </MenuPopup>
        </MenuRoot>
      </header>
      {isResearchView ? (
        <TabsRoot value={tab} onValueChange={(value) => setTab(value as 'chat' | 'plan')} className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
          <TabsList aria-label="Research views" className="shrink-0 px-4 sm:px-6">
            <TabsTab value="chat">Chat</TabsTab>
            <TabsTab value="plan">
              <span className="inline-flex items-center gap-1.5">Plan{sector.state === 'planned' ? <><span aria-hidden className="size-1.5 rounded-full bg-warning" /><span className="sr-only">needs approval</span></> : null}</span>
            </TabsTab>
          </TabsList>
          {subagentStrip}
          {errorNotice}
          <TabsPanel value="chat" keepMounted className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ConversationView key={model.activeThread} model={model} config={config} onContext={() => setContextOpen(true)} />
          </TabsPanel>
          <TabsPanel value="plan" keepMounted className="scroll-slim min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
            <ResearchPlanTab sectorState={sector.state} plan={model.plan} progress={model.progress} global={model.global} actions={actions} workReview={workReview} />
          </TabsPanel>
        </TabsRoot>
      ) : (
        <>{subagentStrip}{errorNotice}<ConversationView key={model.activeThread} model={model} config={config} onContext={() => setContextOpen(true)} /></>
      )}
    </main>
    <aside aria-label="Sector resources" inert={railHidden || undefined} className={cn('hidden min-h-0 shrink-0 overflow-hidden border-l border-border-subtle bg-sidebar transition-[width,opacity] duration-180 ease-out min-[1281px]:block', railHidden ? 'min-[1281px]:w-0 min-[1281px]:border-l-0 min-[1281px]:opacity-0' : 'min-[1281px]:w-90')}>{resourceRail}</aside>
    <WorkspaceOverlay title="Sessions" side open={navOpen} onClose={() => setNavOpen(false)}>{sessionRail}</WorkspaceOverlay>
    <WorkspaceOverlay title="Files and global context" side open={resourcesOpen} onClose={() => setResourcesOpen(false)}><div className="flex h-[calc(100dvh-180px)] min-h-0 flex-col">{resourceRail}</div></WorkspaceOverlay>
    <WorkspaceOverlay title="Local context" side open={contextOpen} onClose={() => setContextOpen(false)} titleBadge={<IconButton label="Execution records" size="icon-sm" onClick={() => model.inspectExecution()}><Icons.executionRecords className="size-4" aria-hidden /></IconButton>}><LocalContextEditor key={model.activeThread} resource={model.local} busy={busy} error={model.error} onSave={(notes, version) => void model.saveLocal(notes, version)} onCompact={() => void model.compact()} inspection={model.operationReceipt} onInspectOperation={model.inspectOperation} onRebuild={(summary, version) => model.rebuildLocal(summary, version)} /></WorkspaceOverlay>
    <ExecutionInspector open={model.executionOpen} page={model.executionPage} body={model.executionBody} selectedSeq={model.executionSeq} hasPrevious={model.executionHasPrevious} onSelect={model.selectExecution} onNext={model.nextExecutionPage} onPrevious={model.previousExecutionPage} onClose={model.closeExecution} />
    <WorkspaceOverlay title="Subagents" open={directory} onClose={() => setDirectory(false)}><AgentDirectory model={model} onOpen={(key) => { model.openThread(key); setDirectory(false) }} onSpawn={() => { setDirectory(false); setSpawnOpen(true) }} onStop={(key, name) => { const id = key.startsWith('agent:') ? key.slice('agent:'.length) : key; setStopTarget({ name, stop: () => model.stopSubagent(id) }) }} /></WorkspaceOverlay>
    {spawnOpen ? <SpawnSubagentDialog busy={busy} onClose={() => setSpawnOpen(false)} onStart={async (goal, name) => { const ok = await model.spawnSubagent(goal, name); if (ok) { notify.success('Subagent started'); setSpawnOpen(false) } return ok }} /> : null}
    <WorkspaceOverlay title="Review file processing retry" open={retryFile !== null} onClose={() => setRetryFile(null)}>{retryFile ? <FileProcessingRetry file={retryFile} latest={model.files.status === 'ready' ? model.files.data?.find((file) => file.id === retryFile.id) : undefined} busy={busy} error={model.error} onRetry={(jobId, revision, allowDuplicatePaid) => model.retryFile(retryFile.id, jobId, revision, allowDuplicatePaid)} onClose={() => setRetryFile(null)} /> : null}</WorkspaceOverlay>
    <WorkspaceOverlay title="File preview" open={model.previewFileId !== null} onClose={() => model.previewFile(null)}><SectorFilePreview resource={model.fileBody} units={model.fileUnits} hasPrevious={model.fileHasPrevious} onBrowse={model.browseFileUnits} onNext={model.nextFileUnits} onPrevious={model.previousFileUnits} /></WorkspaceOverlay>
    {renameTarget ? <RenameSessionDialog key={renameTarget.id} title={renameTarget.title} busy={busy} onClose={() => setRenameTarget(null)} onSave={async (title) => { const ok = await model.renameChat(title); if (ok) { notify.success('Renamed'); setRenameTarget(null) } return ok }} /> : null}
    <ConfirmAction open={deleteTarget !== null} onOpenChange={(next) => { if (!next) setDeleteTarget(null) }} title={deleteTarget ? `Delete "${deleteTarget.title}"?` : 'Delete chat?'} description="The chat is removed from the list. Its history stays in the audit log." confirmLabel="Delete chat" pending={busy} onConfirm={async () => { if (await model.deleteChat()) { notify.success('Chat deleted'); setDeleteTarget(null) } }} />
    <ConfirmAction open={stopTarget !== null} onOpenChange={(next) => { if (!next) setStopTarget(null) }} title="Stop this agent?" description={stopTarget ? `Stop ${stopTarget.name} now? Anything it already finished stays.` : 'Stop this agent now? Anything it already finished stays.'} confirmLabel="Stop agent" pending={busy} onConfirm={async () => { if (stopTarget && await stopTarget.stop()) { notify.success('Stopped'); setStopTarget(null) } }} />
  </div>
}
const scrollPositions = new Map<string, number>()
// @chat markers render as @title chips inside the owner's words. Unknown
// [[session:..]] shapes stay plain text.
function renderChatRefChips(text: string) {
  return text.split(/(\[\[session:[^|\]]+\|[^\]]*\]\])/g).map((part, index) => {
    const match = part.match(/^\[\[session:([^|\]]+)\|([^\]]*)\]\]$/)
    if (!match) return part
    return (
      <span
        key={index}
        className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 font-medium"
      >
        <Icons.chatSession className="size-3.5" aria-hidden />
        @{match[2]}
      </span>
    )
  })
}
function QueueDisclosure({ model }: { model: SectorWorkspaceModel }) {
  const items = model.queue.data ?? []
  if (!items.length) return null
  const move = (index: number, delta: -1 | 1) => {
    const next = items.map((item) => item.id)
    const other = index + delta
    const current = next[index]
    const sibling = next[other]
    if (current === undefined || sibling === undefined) return
    next[index] = sibling
    next[other] = current
    void (async () => { if (!(await model.reorderQueue(next))) notify.error('Could not reorder the queue. Try again.') })()
  }
  return (
    <CollapsibleRoot className="mb-2 rounded-md border border-border-subtle">
      <CollapsibleTrigger className="min-h-9 px-3">
        <Icons.queued aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-left">Queued ({items.length})</span>
        <Icons.chevronDown data-chevron aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="px-2 pt-1 pb-2">
          <List aria-label="Queued messages">
            {items.map((item, index) => (
              <ListRow key={item.id} density="dense">
                <BodySm as="span" className="min-w-0 flex-1 line-clamp-2 [overflow-wrap:anywhere]">{item.text}</BodySm>
                <span className="flex shrink-0 items-center">
                  <IconButton label={`Move ${item.text} up`} size="icon-sm" disabled={index === 0} onClick={() => move(index, -1)}><Icons.moveUp className="size-4" aria-hidden /></IconButton>
                  <IconButton label={`Move ${item.text} down`} size="icon-sm" disabled={index === items.length - 1} onClick={() => move(index, 1)}><Icons.moveDown className="size-4" aria-hidden /></IconButton>
                  <IconButton label={`Remove ${item.text}`} size="icon-sm" onClick={() => { void (async () => { if (!(await model.removeQueued(item.id))) notify.error('Could not remove the message. Try again.') })() }} className="text-danger hover:text-danger"><Icons.delete className="size-4" aria-hidden /></IconButton>
                </span>
              </ListRow>
            ))}
          </List>
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}

function ConversationView({ model, config, onContext }: { model: SectorWorkspaceModel; config: StagingConfig; onContext(): void }) {
  const chat = model.chat
  const { listRef, showLatest, onListScroll, jumpToLatest } = useChatStick(`${model.activeThread}:${chat.messages.length}:${chat.live?.pendingText?.length ?? 0}`)
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { composer.current?.focus(); const position = scrollPositions.get(model.activeThread ?? ''); if (position !== undefined && listRef.current) listRef.current.scrollTop = position }, [model.activeThread, listRef])
  const tools = (chat.live?.pendingTools ?? []).map((tool) => ({ id: tool.id, name: tool.name, detail: '', state: tool.state }))
  const notice = { status: chat.status, refresh: chat.retry, error: chat.error ?? undefined }
  const segments = groupMessageSegments(chat.messages)
  const lastKey = segments.length ? segments[segments.length - 1]?.key : undefined
  const [reasoningOpen, setReasoningOpen] = useReasoningOpen(chat.busy)
  const lastReasoningKey = [...segments].reverse().find((segment) =>
    'tools' in segment ? Boolean(segment.reply?.reasoning) : segment.message.kind === 'text' && Boolean(segment.message.reasoning),
  )?.key
  const emptyVariant = model.selected?.kind === 'research' && !model.child ? 'research' as const : 'chat' as const
  // @chat references (research main thread only): typing @ offers the
  // sector chats; picking inserts @title while the id mapping stays in
  // composer state, and send expands each @title to
  // [[session:id|title]]. Deleting the @title text drops its mapping.
  const chatRefEnabled = model.selected?.kind === 'research' && !model.child
  const [chatRefClosed, setChatRefClosed] = useState(false)
  const [chatRefIndex, setChatRefIndex] = useState(0)
  const [chatRefMentions, setChatRefMentions] = useState<Array<{ id: string; title: string }>>([])
  // A new draft reopens the listbox from the top and prunes mappings
  // whose text is gone: adjust during render (never in an effect) so
  // the compiler sees no cascading setState.
  const [chatRefDraft, setChatRefDraft] = useState(chat.draft)
  if (chatRefDraft !== chat.draft) {
    setChatRefDraft(chat.draft); setChatRefClosed(false); setChatRefIndex(0)
    const pruned = chatRefMentions.filter((mention) => chat.draft.includes(`@${mention.title}`))
    if (pruned.length !== chatRefMentions.length) setChatRefMentions(pruned)
  }
  const chatRefMatch = chatRefEnabled && !chatRefClosed ? chat.draft.match(/@([^@\n]*)$/) : null
  const chatRefQuery = (chatRefMatch?.[1] ?? '').toLowerCase()
  const chatRefOptions = chatRefMatch
    ? (model.sessions.data ?? []).filter((session) => session.id !== model.selected?.id && session.title.toLowerCase().includes(chatRefQuery))
    : []
  const chatRefOpen = chatRefMatch !== null && chatRefOptions.length > 0
  function insertChatRef(pick: { id: string; title: string }) {
    if (!chatRefMatch || chatRefMatch.index === undefined) return
    chat.setDraft(`${chat.draft.slice(0, chatRefMatch.index)}@${pick.title} `)
    setChatRefMentions((mentions) => [...mentions.filter((mention) => mention.title !== pick.title), { id: pick.id, title: pick.title }])
    setChatRefIndex(0)
    composer.current?.focus()
  }
  function expandChatRefs(draft: string): string {
    let text = draft
    for (const mention of [...chatRefMentions].sort((a, b) => b.title.length - a.title.length)) {
      text = text.split(`@${mention.title}`).join(`[[session:${mention.id}|${mention.title}]]`)
    }
    return text
  }
  function sendChat(steer = false) {
    const expanded = expandChatRefs(chat.draft)
    if (expanded === chat.draft) return chat.send(steer)
    return chat.send(steer, expanded)
  }
  const threadPaused = model.threads.data?.find((thread) => thread.key === model.activeThread)?.status === 'PAUSED'
  const composerPlaceholder = model.child ? 'Steer or message this subagent...' : model.selected?.kind === 'research' ? 'Ask about this research...' : 'Message...'
  // Send-context failures only: history load errors belong to the thread's
  // ResourceNotice (Retry there reloads history), while the composer's
  // Retry resends: showing a load error under the composer, possibly
  // disabled, would strand a dead Retry button.
  const composerError = chat.status === 'ready' && !chat.missedInstructions.length && chat.phase !== 'reconnecting' && chat.phase !== 'failed' && chat.phase !== 'paused' && !threadPaused ? (chat.error ?? null) : null
  return <div className="flex min-h-0 flex-1 flex-col"><div className="relative min-h-0 flex-1"><div ref={listRef} onScroll={() => { onListScroll(); if (listRef.current) scrollPositions.set(model.activeThread ?? '', listRef.current.scrollTop) }} role="log" aria-label="Conversation messages" aria-live="polite" className="scroll-slim h-full overflow-y-auto px-4 py-6 sm:px-8"><div className="mx-auto max-w-prose-kd space-y-6"><ResourceNotice resource={notice} label="Conversation" />{chat.status === 'ready' && chat.messages.length === 0 && !chat.echo ? <ConversationEmpty variant={emptyVariant} onSuggest={(text) => { chat.setDraft(text); composer.current?.focus() }} /> : null}
    {<AssistantRuntimeAdapter messages={toThreadSegments(segments)} isRunning={chat.busy} onSend={() => undefined}><ThreadPrimitive.Root><ThreadPrimitive.Messages>{({ message: runtimeMessage }) => { const segment = segments.find((entry) => entry.key === runtimeMessage.id); if (!segment) return null; const control = segment.key === lastReasoningKey ? { open: reasoningOpen, onOpenChange: setReasoningOpen } : undefined; return 'tools' in segment ? <div key={segment.key} className="space-y-2"><ToolActivity tools={segment.tools} />{segment.reply?.reasoning ? <ReasoningDisclosure reasoning={segment.reply.reasoning} open={control?.open} onOpenChange={control?.onOpenChange} /> : null}{segment.reply ? <AgentBubble copyText={segment.reply.text} timestamp={segment.reply.at} latest={segment.key === lastKey}><Markdown text={segment.reply.text} /></AgentBubble> : null}</div> : segment.message.kind === 'text' ? segment.message.role === 'user' ? <UserBubble key={segment.message.id}>{renderChatRefChips(segment.message.text)}</UserBubble> : <div key={segment.message.id} className="space-y-2">{segment.message.reasoning ? <ReasoningDisclosure reasoning={segment.message.reasoning} open={control?.open} onOpenChange={control?.onOpenChange} /> : null}<AgentBubble copyText={segment.message.text} timestamp={segment.message.at} latest={segment.key === lastKey}><Markdown text={segment.message.text} /></AgentBubble></div> : null }}</ThreadPrimitive.Messages></ThreadPrimitive.Root></AssistantRuntimeAdapter>}
    {chat.echo ? <UserBubble>{renderChatRefChips(chat.echo)}</UserBubble> : null}{tools.length || chat.live?.pendingReasoning || chat.live?.pendingText ? <div className="space-y-2">{tools.length ? <ToolActivity tools={tools} live /> : null}{chat.live?.pendingReasoning ? <ThinkingRow reasoning={chat.live.pendingReasoning} open={reasoningOpen} onOpenChange={setReasoningOpen} /> : null}{chat.live?.pendingText ? <AgentBubble><Markdown text={chat.live.pendingText} /></AgentBubble> : null}</div> : null}{chat.phase === 'queued' ? <p role="status" className="flex items-center gap-2"><Icons.queued aria-hidden className="size-3.5 text-muted-foreground" /><Caption as="span">Queued, waiting for the agent</Caption></p> : chat.phase === 'reconnecting' ? <div role="status" className="flex gap-2 rounded-md border border-info-border bg-info-soft p-3"><span className="flex h-5 shrink-0 items-center"><Icons.alertInfo aria-hidden className="size-4 text-info" /></span><BodySm as="span" className="min-w-0 flex-1">Reconnecting. Your conversation is saved.</BodySm><Button type="button" variant="ghost" size="sm" onClick={chat.retry} className="shrink-0">Reconnect now</Button></div> : chat.phase === 'paused' || threadPaused ? <div role="status" className="flex gap-2 rounded-md border border-warning-border bg-warning-soft p-3"><span className="flex h-5 shrink-0 items-center"><Icons.alertWarning aria-hidden className="size-4 text-warning" /></span><BodySm as="span" className="min-w-0 flex-1">This conversation is paused.</BodySm><Button type="button" variant="ghost" size="sm" disabled={Boolean(model.operation)} onClick={() => void model.resume()} className="shrink-0">Resume</Button></div> : chat.phase === 'failed' ? <div role="alert" className="flex gap-2 rounded-md border border-danger-border bg-danger-soft p-3"><span className="flex h-5 shrink-0 items-center"><Icons.alertError aria-hidden className="size-4 text-danger" /></span><BodySm as="span" className="min-w-0 flex-1">That reply did not go through.</BodySm><Button type="button" variant="ghost" size="sm" onClick={() => void sendChat()} className="shrink-0">Retry</Button></div> : chat.busy && !chat.live?.pendingText && !tools.length && !chat.live?.pendingReasoning ? <ThinkingRow /> : null}
  </div></div><AnimatePresence>{showLatest ? <div className="absolute bottom-3 left-1/2 -translate-x-1/2"><m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}><Button size="sm" variant="secondary" className="rounded-full shadow-sm" onClick={jumpToLatest}><Icons.latest aria-hidden />Latest</Button></m.div></div> : null}</AnimatePresence></div>
  <ConversationComposer label="Message this conversation" input={<>{model.selected?.useGlobalContext === false ? <button type="button" onClick={() => { void (async () => { if (await model.setUseGlobalContext(true)) notify.success('Global context on for this chat') })() }} className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-sunken px-2.5 py-1" aria-label="Global context off. Turn it back on."><Icons.globalContext aria-hidden className="size-3.5 text-muted-foreground" /><Caption as="span">Global context off</Caption></button> : null}<QueueDisclosure model={model} /><Composer
    id="workspace-composer"
    label="Message this conversation"
    value={chat.draft}
    onChange={chat.setDraft}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && chatRefOpen) { event.stopPropagation(); setChatRefClosed(true); return }
      if (chatRefOpen) {
        if (event.key === 'ArrowDown') { event.preventDefault(); setChatRefIndex((index) => (index + 1) % chatRefOptions.length); return }
        if (event.key === 'ArrowUp') { event.preventDefault(); setChatRefIndex((index) => (index - 1 + chatRefOptions.length) % chatRefOptions.length); return }
        if (event.key === 'Enter' && !event.shiftKey) {
          const picked = chatRefOptions[chatRefIndex]
          if (picked) { event.preventDefault(); insertChatRef(picked); return }
        }
      }
      if (event.key === 'Enter' && !event.shiftKey && !chat.busy) { event.preventDefault(); void sendChat() }
    }}
    listboxes={chatRefOpen ? (
      <ul
        role="listbox"
        aria-label="Mention a chat"
        className={`absolute bottom-full left-0 z-50 mb-2 max-h-56 w-72 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${popoverEnter}`}
      >
        <li role="presentation" className="px-2 pt-1.5 pb-1">
          <Overline>Chats</Overline>
        </li>
        {chatRefOptions.map((option, index) => (
          <li key={option.id} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={index === chatRefIndex}
              aria-label={option.title}
              onClick={() => insertChatRef(option)}
              className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui ${index === chatRefIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'} ${focusRingInset}`}
            >
              <Icons.chatSession className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{option.title}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null}
    placeholder={composerPlaceholder}
    disabled={!model.activeThread || chat.status === 'denied'}
    textareaRef={composer}
    left={<><IconButton label="Local context" onClick={onContext}><Icons.localContext className="size-4" aria-hidden /></IconButton>{model.selected ? <ModelToolbar config={config} sessionId={model.selected.id} bare /> : null}</>}
    right={chat.busy ? <><Button type="button" variant="primary" size="sm" disabled={!chat.draft.trim()} onClick={() => void sendChat(true)}><Icons.steer className="size-3.5" aria-hidden />Steer</Button><Button type="button" variant="secondary" size="sm" disabled={!chat.draft.trim()} onClick={() => void sendChat()}>Queue</Button><IconButton label="Stop agent" disabled={Boolean(model.operation)} onClick={() => void model.stop()} className="text-danger hover:text-danger"><Icons.stopRun className="size-4" aria-hidden /></IconButton></> : <IconButton label="Send message" shortcut="Enter" variant="default" size="icon-sm" disabled={!chat.draft.trim() || !model.activeThread} onClick={() => void sendChat()} className="rounded-full"><Icons.send className="size-4" aria-hidden /></IconButton>}
    error={composerError}
    onRetry={() => void sendChat()}
  />{chat.missedInstructions.length ? <section aria-label="Unapplied steering" className="mt-2 flex gap-2 rounded-md border border-info-border bg-info-soft p-3"><span className="flex h-5 shrink-0 items-center"><Icons.alertInfo aria-hidden className="size-4 text-info" /></span><div className="min-w-0 flex-1"><BodySm as="p">Steering saved for your next turn</BodySm>{chat.missedInstructions.map((text, index) => <BodySm as="p" key={index} className="mt-1 border-l-2 border-border-strong pl-2 whitespace-pre-wrap break-words text-muted-foreground">“{text}”</BodySm>)}</div><Button type="button" variant="ghost" size="sm" onClick={() => void sendChat()} className="shrink-0">Send now</Button></section> : null}</>} /></div>
}
function AgentDirectory({ model, onOpen, onSpawn, onStop }: { model: SectorWorkspaceModel; onOpen(key: string): void; onSpawn(): void; onStop(key: string, name: string): void }) {
  function childId(key: string) {
    return key.startsWith('agent:') ? key.slice('agent:'.length) : key
  }
  const [search, setSearch] = useState(''), [limit, setLimit] = useState(50)
  const rows = model.threads.data?.filter((thread) => thread.kind === 'subagent' && `${thread.name ?? ''} ${thread.key}`.toLowerCase().includes(search.toLowerCase())) ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={onSpawn}>New subagent</Button>
      </div>
      <SearchField value={search} onChange={(value) => { setSearch(value); setLimit(50) }} label="Search subagents" />
      <ResourceNotice resource={model.threads} label="Subagents" />
      <Caption>Showing {Math.min(limit, rows.length)} of {rows.length}</Caption>
      <List aria-label="Subagents">
        {rows.slice(0, limit).map((thread, index) => {
          const name = subagentDisplayName(thread, index)
          const paused = thread.status === 'PAUSED'
          return (
            <li key={thread.key} className="flex items-center gap-1">
              <button
                type="button"
                data-list-row=""
                aria-label={`Open ${name}`}
                title={thread.key}
                onClick={() => onOpen(thread.key)}
                className={`${listRowClassName({ density: 'default' })} min-w-0 flex-1`}
              >
                <Icons.agents aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <BodySm as="span" className="block truncate">{name}</BodySm>
                  {thread.queueDepth > 0 ? <Caption as="span" className="mt-0.5 block tabular-nums">{thread.queueDepth} queued</Caption> : null}
                </span>
                <Badge tone={thread.status === 'RUNNING' ? 'success' : thread.status === 'QUEUED' || paused ? 'warning' : 'neutral'}>{threadStatusLabel(thread.status)}</Badge>
              </button>
              {paused
                ? <IconButton label={`Resume ${name}`} size="icon-sm" onClick={() => void model.resumeSubagent(childId(thread.key))}><Icons.play className="size-4" aria-hidden /></IconButton>
                : thread.status === 'RUNNING' ? <IconButton label={`Pause ${name}`} size="icon-sm" onClick={() => void model.pauseSubagent(childId(thread.key))}><Icons.pause className="size-4" aria-hidden /></IconButton> : null}
              {thread.status === 'RUNNING' ? <IconButton label={`Stop ${name}`} size="icon-sm" onClick={() => onStop(thread.key, name)} className="text-danger hover:text-danger"><Icons.stopRun className="size-4" aria-hidden /></IconButton> : null}
            </li>
          )
        })}
      </List>
      {!rows.length && model.threads.status === 'ready' ? <Description>No matching subagents.</Description> : null}
      {rows.length > limit ? <Button type="button" variant="secondary" size="sm" onClick={() => setLimit(limit + 50)}>Show more</Button> : null}
    </div>
  )
}
/** Spawn dialog (A15): goal plus an optional name for the child. */
function SpawnSubagentDialog({ busy, onClose, onStart }: { busy: boolean; onClose(): void; onStart(goal: string, name?: string): Promise<boolean> }) {
  const [goal, setGoal] = useState('')
  const [name, setName] = useState('')
  const goalRef = useRef<HTMLTextAreaElement | null>(null)
  const goalId = useId()
  const nameId = useId()
  async function start(): Promise<void> {
    if (busy || !goal.trim()) return
    await onStart(goal.trim(), name.trim() || undefined)
  }
  return (
    <WorkspaceOverlay
      title="New subagent"
      size="small"
      onClose={onClose}
      initialFocus={goalRef}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" pending={busy} disabled={!goal.trim()} onClick={() => void start()}>Start subagent</Button>
        </>
      }
    >
      <form aria-label="New subagent" onSubmit={(event) => { event.preventDefault(); void start() }} className="space-y-3">
        <div>
          <Label as="label" htmlFor={goalId}>Goal</Label>
          <textarea
            ref={goalRef}
            id={goalId}
            value={goal}
            rows={3}
            onChange={(event) => setGoal(event.target.value)}
            className="scroll-slim mt-1.5 block max-h-44 min-h-8 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-foreground-subtle"
          />
        </div>
        <div>
          <Label as="label" htmlFor={nameId}>Name (optional)</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5"
          />
        </div>
      </form>
    </WorkspaceOverlay>
  )
}
/** Rename dialog (SO-01): autofocused name field with select-all. */
export function RenameSessionDialog({ title, busy, onClose, onSave }: { title: string; busy: boolean; onClose(): void; onSave(title: string): Promise<boolean> }) {
  const [name, setName] = useState(title)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectedOnce = useRef(false)
  const nameId = useId()
  async function save(): Promise<void> {
    if (busy || !name.trim()) return
    if (await onSave(name.trim())) onClose()
  }
  return (
    <WorkspaceOverlay
      title="Rename chat"
      size="small"
      onClose={onClose}
      initialFocus={inputRef}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" pending={busy} disabled={!name.trim()} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <form aria-label="Rename chat" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <Label as="label" htmlFor={nameId}>Chat name</Label>
        <Input
          ref={inputRef}
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => {
            // Select-all rides the initial focus (Base UI moves focus
            // after mount, which would collapse an effect-time select).
            if (!selectedOnce.current) {
              selectedOnce.current = true
              event.currentTarget.select()
            }
          }}
          className="mt-1.5"
        />
      </form>
    </WorkspaceOverlay>
  )
}
