import { useSupervisionAlerts } from './data/alerts'
import { SupervisionAlertsPanel } from './components/SupervisionAlertsPanel'
import { useEffect, useRef, useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import type { ChatScope } from './components/chat/messages'
import { Dashboard, type ResearchList } from './components/Dashboard'
import { ModelsPanel } from './components/ModelsPanel'
import { ResearchesPage } from './components/ResearchesPage'
import { RunsPanel } from './components/RunsPanel'
import { SectorLanding, sectorMetaLine } from './components/SectorLanding'
import { SectorWorkspace } from './components/SectorWorkspace'
import { useSectorWorkspace } from './data/sector-workspace'
import { useWorkspaceResource } from './data/useWorkspace'
import { getResearchProgress } from './data/workspace-api'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import {
  useStagingCompanies,
  useStagingSectorDetail,
  useStagingSectors,
} from './data/research'
import {
  approveSectorPlan,
  createSector,
  pauseSector,
  planSector,
  resumeSector,
  startSector,
  updateSectorPlan,
  stagingConfig,
  type StagingConfig,
} from './data/staging-api'
import { useExitState, pageEnter } from './lib/motion'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import { useNavigation } from './lib/useNavigation'
import { StateBadge, stateLabel } from './components/research-parts'
import { CreateSectorDialog } from './components/CreateSectorDialog'
import { Button } from './components/ui/button'
import { Icons } from '@/lib/icons'
import { notify } from './lib/toast'
import { PageHeader, ResourceState } from './components/shells'
import { CommandPalette, type PaletteSection } from './components/CommandPalette'
import { TooltipProvider } from './components/ui/tooltip'
import { useTheme } from './lib/theme'
import { Toaster } from 'sonner'

function AppOverlays({
  paletteOpen,
  onPaletteOpenChange,
  sectors,
  onNavigate,
  onSelectSector,
  onNewSector,
  onOpenKarbot,
  onToggleTheme,
  theme,
}: {
  paletteOpen: boolean
  onPaletteOpenChange: (open: boolean) => void
  sectors: Array<{ id: string; name: string; topic: string }>
  onNavigate: (section: PaletteSection) => void
  onSelectSector: (sectorId: string) => void
  onNewSector: () => void
  onOpenKarbot: () => void
  onToggleTheme: () => void
  theme: 'light' | 'dark'
}) {
  return (
    <>
      <Toaster
        theme={theme}
        position="bottom-right"
        offset={16}
        gap={8}
        visibleToasts={3}
        toastOptions={{
          duration: 4000,
          style: { width: 356 },
          classNames: {
            toast: 'rounded-lg border border-border bg-popover text-popover-foreground shadow-md',
            title: 'text-sm font-medium text-popover-foreground',
            description: 'text-ui text-muted-foreground',
            actionButton: 'bg-primary text-primary-foreground hover:bg-primary-hover',
            cancelButton: 'border border-border bg-card text-foreground hover:bg-surface-hover',
          },
        }}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={onPaletteOpenChange}
        sectors={sectors}
        onNavigate={onNavigate}
        onSelectSector={onSelectSector}
        onNewSector={onNewSector}
        onOpenKarbot={onOpenKarbot}
        onToggleTheme={onToggleTheme}
      />
    </>
  )
}

export default function App() {
  // View state lives in the URL (useNavigation): refresh, deep links, and
  // Back/Forward restore the view instead of dropping to home.
  const [nav, setNav] = useNavigation()
  const { researchTab } = nav
  // Removed sections (Settings) fall back to home instead of rendering a
  // stranger's panel.
  const section = nav.section === 'Researches' || nav.section === 'SectorDetail' || nav.section === 'SectorChat' || nav.section === 'Agents' || nav.section === 'Models' || nav.section === 'Emails'
    ? nav.section
    : 'Overview'
  const sectorId = section === 'SectorDetail' || section === 'SectorChat' ? nav.sectorId : null
  const [createOpen, setCreateOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const { preference: themePreference, resolved: resolvedTheme, setPreference: setThemePreference } = useTheme()
  const dark = resolvedTheme === 'dark'
  const toggleTheme = (): void => setThemePreference(dark ? 'light' : 'dark')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [chatScope, setChatScope] = useState<ChatScope>(null)
  const [researchBusy, setResearchBusy] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const chatDock = useExitState(false)
  const chatOpen = chatDock.open
  const chatClosing = chatDock.closing
  // Backend config when the flag and credentials are present; without it
  // the app explains instead of inventing data. Read once; flipping the
  // flag reloads.
  const [staging] = useState<StagingConfig | null>(() => stagingConfig())
  const alerts = useSupervisionAlerts(staging, section === 'Agents')
  const [runsRefresh, setRunsRefresh] = useState(0)
  const [runsLoading, setRunsLoading] = useState(false)

  function focusChatToggle() {
    requestAnimationFrame(() => {
      // Two labelled toggles exist (desktop + mobile); focus the visible one.
      const candidates = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Ask Karbot"]')]
      candidates.find((el) => el.offsetParent !== null)?.focus()
    })
  }

  // Dock exit runs through the shared useExitState so open, close, and
  // reopen-cancel behave like every other popover. Focus returns to the
  // chat toggle; the hook keeps content and focus work under reduced motion.
  function closeChat() {
    chatDock.set(false)
    focusChatToggle()
  }

  function openChat() {
    chatDock.set(true)
    setChatScope(null)
  }
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Every bundle reads the backend; without a config the hooks stay in an
  // empty ready state and the views render the not-configured notice.
  const sectors = useStagingSectors(staging)
  const companies = useStagingCompanies(staging)
  const detailData = useStagingSectorDetail(staging, sectorId)
  const workspace = useSectorWorkspace(section === 'SectorChat' ? staging : null, section === 'SectorChat' ? sectorId : null, nav.sessionId ?? null, nav.threadKey ?? null, (sessionId, threadKey) => setNav({ sessionId, threadKey }))
  const progress = useWorkspaceResource(staging, sectorId ? `progress:${sectorId}` : null, (config) => getResearchProgress(config, sectorId ?? ''), detailData.detail?.state === 'running' || detailData.detail?.state === 'planning' || detailData.detail?.state === 'queued')
  const followResearch = detailData.detail?.state === 'running' || detailData.detail?.state === 'planning' || detailData.detail?.state === 'queued'
  const retryDetail = detailData.retry
  useEffect(() => {
    if (!followResearch || !sectorId) return
    const timer = setInterval(retryDetail, 5000)
    return () => clearInterval(timer)
  }, [followResearch, sectorId, retryDetail])

  async function pauseCurrentSector() {
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await pauseSector(staging, sectorId)
      detailData.refresh()
      notify.success('Research paused')
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Pause failed.')
    } finally {
      setResearchBusy(false)
    }
  }

  async function resumeCurrentSector() {
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await resumeSector(staging, sectorId)
      detailData.refresh()
      notify.success('Research resumed')
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Resume failed.')
    } finally {
      setResearchBusy(false)
    }
  }

  async function startCurrentSector() {
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await startSector(staging, sectorId)
      detailData.refresh()
      notify.success('Research started')
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Start failed.')
    } finally {
      setResearchBusy(false)
    }
  }

  async function planCurrentSector() {
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await planSector(staging, sectorId)
      detailData.refresh()
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Plan failed.')
    } finally {
      setResearchBusy(false)
    }
  }

  async function approveCurrentSector(version: number, contextVersion?: number) {
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await approveSectorPlan(staging, sectorId, version, contextVersion)
      detailData.refresh()
      workspace.plan.refresh()
      workspace.progress.refresh()
      workspace.global.refresh()
      notify.success(`Plan v${version} approved`)
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Approve failed.')
    } finally {
      setResearchBusy(false)
    }
  }

  async function editCurrentSectorPlan(markdown: string) {
    if (!sectorId || !staging) return false
    setResearchBusy(true)
    setResearchError(null)
    try {
      const nextVersion = (workspace.plan.data?.latest?.version ?? 0) + 1
      await updateSectorPlan(staging, sectorId, markdown)
      detailData.refresh()
      workspace.plan.refresh()
      notify.success(`Plan saved as v${nextVersion}. Review reopens.`)
      return true
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Plan edit failed.')
      return false
    } finally {
      setResearchBusy(false)
    }
  }

  async function createDraftSector(name: string, topic: string) {
    if (!staging || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const sector = await createSector(staging, { name, topic: topic || undefined, state: 'draft' })
      sectors.retry()
      notify.success('Sector created')
      setNav({ section: 'SectorDetail', sectorId: sector.id })
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : 'Create failed.')
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // Section-change contract: crossfade (CSS), scroll to top, focus heading.
  // Focus carries the screen-reader announcement; all three run even when
  // reduced motion collapses the fade to zero.
  useEffect(() => {
    window.scrollTo(0, 0)
    headingRef.current?.focus({ preventScroll: true })
  }, [section])

  function goResearches(tab: ResearchList) {
    setNav({ section: 'Researches', researchTab: tab, sectorId: null, filterQuery: null, stateFilter: null })
  }

  function goResearchesFiltered(tab: ResearchList, state: string | null) {
    setNav({ section: 'Researches', researchTab: tab, sectorId: null, filterQuery: null, stateFilter: state })
  }

  function goSector(id: string) {
    setNav({ section: 'SectorDetail', sectorId: id })
  }

  const detail = detailData.detail
  // Header titles come from a label map, never raw section ids; an async
  // sector title shows a skeleton while it loads, and a missing sector
  // names itself instead of flashing a raw id.
  const sectorView = section === 'SectorDetail' || section === 'SectorChat'
  // Without a detail the header names the state itself; the landing body
  // below suppresses its own title (hideTitle) instead of repeating it.
  const sectorFallbackTitle =
    detailData.status === 'ready'
      ? 'Sector not found'
      : detailData.status === 'denied'
        ? 'Access denied'
        : detailData.status === 'offline'
          ? 'You are offline'
          : detailData.status === 'error'
            ? 'Sector did not load.'
            : 'Sector research'
  const headerTitle = sectorView ? (detail?.name ?? sectorFallbackTitle) : section
  const headerLoading = sectorView && !detail && detailData.status === 'loading'
  const headerDescription =
    !staging
      ? undefined
      : sectorView
        ? (detail?.topic ?? undefined)
        : section === 'Overview'
          ? 'Research activity across all sectors.'
          : section === 'Researches'
            ? 'Sectors you research and the companies they discover.'
            : section === 'Agents'
              ? 'Runs and supervision alerts across your sessions.'
              : section === 'Models'
                ? 'Choose the provider and model each session uses.'
                : undefined
  const headerCrumbs =
    staging && section === 'SectorDetail' && detail
      ? [
          { label: 'Researches', onSelect: () => setNav({ section: 'Researches', sectorId: null }) },
          { label: detail.name },
        ]
      : undefined
  const headerBadge = staging && section === 'SectorDetail' && detail ? <StateBadge state={detail.state} /> : undefined
  const headerMeta = staging && section === 'SectorDetail' && detail ? sectorMetaLine(detail) : undefined
  const headerActions =
    staging && section === 'SectorDetail' && detail ? (
      <>
        <Button type="button" variant="secondary" size="sm" onClick={() => setProgressOpen(true)}>
          <Icons.progress aria-hidden />
          View progress
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setNav({ section: 'SectorChat', sectorId: detail.id, sessionId: null, threadKey: null, view: null })}
        >
          Open workspace
          <Icons.openExternal aria-hidden />
        </Button>
      </>
    ) : staging && (section === 'Overview' || section === 'Researches') ? (
      <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
        <Icons.plus aria-hidden />
        New sector
      </Button>
    ) : staging && section === 'Agents' ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={alerts.resource.status === 'loading' || runsLoading}
        onClick={() => { alerts.resource.refresh(); setRunsRefresh((value) => value + 1) }}
      >
        <Icons.retry aria-hidden className={alerts.resource.status === 'loading' || runsLoading ? 'motion-safe:animate-spin' : undefined} />
        Refresh
      </Button>
    ) : undefined
  // Context summary derives from the served sector detail and recomputes
  // whenever its numbers or state change; the chip follows.
  const detailState = detail?.state ?? 'queued'
  const contextSummary =
    chatScope && detail && sectorId && chatScope.id === sectorId
      ? `${detail.name} · ${detail.companiesFound} found · ${stateLabel[detailState]}`
      : null
  const contextDetails =
    chatScope && detail && sectorId && chatScope.id === sectorId
      ? [
          { label: 'Sector', value: detail.name },
          { label: 'Found', value: `${detail.companiesFound}` },
          { label: 'State', value: stateLabel[detailState] },
        ]
      : []

  if (section === 'SectorChat' && detailData.detail && staging && detailData.status !== 'denied') {
    return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation}><TooltipProvider delay={400}><SectorWorkspace sector={detailData.detail} model={workspace} config={staging} initialView={nav.view === 'plan' ? 'plan' : 'chat'} onBack={() => setNav({ section: 'SectorDetail', sessionId: null, threadKey: null, view: null })} actions={{ busy: researchBusy, error: researchError, plan: () => void planCurrentSector(), approve: (version, contextVersion) => void approveCurrentSector(version, contextVersion), start: () => void startCurrentSector(), pause: () => void pauseCurrentSector(), resume: () => void resumeCurrentSector(), edit: editCurrentSectorPlan }} /><AppOverlays
          paletteOpen={paletteOpen}
          onPaletteOpenChange={setPaletteOpen}
          sectors={(sectors.items ?? []).map((sector) => ({ id: sector.id, name: sector.name, topic: sector.topic }))}
          onNavigate={(section) => setNav({ section })}
          onSelectSector={goSector}
          onNewSector={() => setNav({ section: 'Researches' })}
          onOpenKarbot={() => openChat()}
          onToggleTheme={toggleTheme}
          theme={resolvedTheme}
        /></TooltipProvider></LazyMotion></MotionConfig>
  }
  return (
    <MotionConfig reducedMotion="user">
    <LazyMotion features={domAnimation}>
    <TooltipProvider delay={400}>
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar active={section} onSelect={(next) => setNav({ section: next, sectorId: null })} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          chatOpen={chatOpen}
          onChatToggle={() => {
            if (chatOpen) {
              closeChat()
            } else {
              openChat()
            }
          }}
          onOpenPalette={() => setPaletteOpen(true)}
          themePreference={themePreference}
          onThemePreference={setThemePreference}
        />
        {chatDock.mounted ? (
          <ChatPanel
            key={chatScope ? chatScope.id : 'general'}
            config={staging}
            closing={chatClosing}
            scope={chatScope}
            contextSummary={contextSummary}
            contextDetails={contextDetails}
            onClose={closeChat}
          />
        ) : null}
        <main className="flex-1 px-4 pt-6 pb-12 md:px-6 min-[1440px]:px-8">
          <div
            key={section}
            className={`mx-auto w-full max-w-page ${pageEnter}`}
          >
            <PageHeader
              ref={headingRef}
              tabIndex={-1}
              title={headerTitle}
              description={headerDescription}
              actions={headerActions}
              badge={headerBadge}
              crumbs={headerCrumbs}
              meta={headerMeta}
              loading={headerLoading}
              titleClassName="focus:outline-none"
            />
            {!staging ? (
              <ResourceState
                resource={{ status: 'ready', refresh: () => window.location.reload() }}
                label="Backend"
                emptyKind="first"
                icon={<Icons.notConnected aria-hidden />}
                emptyTitle="Connect the backend"
                emptyBody="Set the staging API URL and key in the frontend environment, then reload."
                emptyAction={
                  <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()}>
                    Reload
                  </Button>
                }
              />
            ) : section === 'Overview' ? (
              <Dashboard
                onViewAll={goResearches}
                onOpenFiltered={goResearchesFiltered}
                onOpenSector={goSector}
                onNewSector={() => setCreateOpen(true)}
                sectors={sectors}
                companies={companies}
              />
            ) : section === 'Researches' ? (
              <ResearchesPage
                initialTab={researchTab}
                sectors={sectors}
                companiesTotal={companies.total}
                staging={staging}
                filterQuery={nav.filterQuery ?? null}
                stateFilter={nav.stateFilter ?? null}
                onTabChange={(tab) => setNav({ researchTab: tab })}
                onFiltersChange={(query, state) =>
                  setNav({ filterQuery: query === '' ? null : query, stateFilter: state === 'all' ? null : state })
                }
                onOpenSector={goSector}
                onNewSector={() => setCreateOpen(true)}
              />
            ) : section === 'SectorDetail' || section === 'SectorChat' ? (
              <SectorLanding
                key={sectorId}
                sector={detailData.detail}
                status={detailData.status}
                config={staging}
                progress={progress}
                progressOpen={progressOpen}
                onProgressOpenChange={setProgressOpen}
                onOpen={() => setNav({ section: 'SectorChat', sessionId: null, threadKey: null, view: null })}
                onReviewPlan={() => setNav({ section: 'SectorChat', sessionId: null, threadKey: null, view: 'plan' })}
                onRetry={detailData.retry}
                onBack={() => setNav({ section: 'Researches', sectorId: null })}
              />
            ) : section === 'Agents' ? (
              <div className="flex min-w-0 flex-col gap-6">
              <SupervisionAlertsPanel
                resource={alerts.resource}
                viewingOlder={alerts.viewingOlder}
                onOlder={alerts.older}
                onLatest={alerts.latest}
                onOpenConversation={(alert) => {
                  if (alert.sectorId) setNav({ section: 'SectorChat', sectorId: alert.sectorId, sessionId: alert.sessionId, threadKey: alert.threadKey, view: null })
                }}
              />
              <RunsPanel config={staging} refreshSignal={runsRefresh} onLoadingChange={setRunsLoading} />
              </div>
            ) : section === 'Models' ? (
              <ModelsPanel config={staging} />
            ) : section === 'Emails' ? (
              <section aria-label="Emails">
                <ResourceState
                  resource={{ status: 'ready', refresh: () => undefined }}
                  label="Emails"
                  emptyKind="first"
                  icon={<Icons.emails aria-hidden />}
                  emptyTitle="Email tracking is coming soon"
                  emptyBody="Scheduled, sent and reply counts will appear here once email tracking is connected."
                />
              </section>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-background p-4">
                <p className="text-sm font-medium">Unknown section.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This view does not exist in this build.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
    <CreateSectorDialog
      creating={creating}
      createError={createError}
      onCreate={createDraftSector}
      open={createOpen}
      onOpenChange={setCreateOpen}
      trigger={false}
    />
    <AppOverlays
          paletteOpen={paletteOpen}
          onPaletteOpenChange={setPaletteOpen}
          sectors={(sectors.items ?? []).map((sector) => ({ id: sector.id, name: sector.name, topic: sector.topic }))}
          onNavigate={(section) => setNav({ section })}
          onSelectSector={goSector}
          onNewSector={() => setCreateOpen(true)}
          onOpenKarbot={() => openChat()}
          onToggleTheme={toggleTheme}
          theme={resolvedTheme}
        />
    </TooltipProvider>
    </LazyMotion>
    </MotionConfig>
  )
}