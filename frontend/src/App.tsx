import { useEffect, useRef, useState } from 'react'
import { ChatPanel, type ChatScope } from './components/ChatPanel'
import { Dashboard, type ResearchList } from './components/Dashboard'
import { ModelsPanel } from './components/ModelsPanel'
import { ResearchesPage } from './components/ResearchesPage'
import { RunsPanel } from './components/RunsPanel'
import { SectorLanding } from './components/SectorLanding'
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
import { useExitState } from './lib/motion'
import { useNavigation } from './lib/useNavigation'
import { stateLabel } from './components/research-parts'

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
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(false)
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

  function focusChatToggle() {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Open chat"]')
        ?.focus()
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

  async function approveCurrentSector(version: number) {
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await approveSectorPlan(staging, sectorId, version)
      detailData.refresh()
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
      await updateSectorPlan(staging, sectorId, markdown)
      detailData.refresh()
      workspace.plan.refresh()
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
    setNav({ section: 'Researches', researchTab: tab, sectorId: null })
  }

  function goSector(id: string) {
    setNav({ section: 'SectorDetail', sectorId: id })
  }

  const detail = detailData.detail
  const heading = section === 'SectorDetail' ? (detail?.name ?? 'Sector research') : section
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
    return <SectorWorkspace sector={detailData.detail} model={workspace} config={staging} dark={dark} onTheme={() => setDark((value) => !value)} onBack={() => setNav({ section: 'SectorDetail', sessionId: null, threadKey: null })} actions={{ busy: researchBusy, error: researchError, plan: () => void planCurrentSector(), approve: (version) => void approveCurrentSector(version), start: () => void startCurrentSector(), pause: () => void pauseCurrentSector(), resume: () => void resumeCurrentSector(), edit: editCurrentSectorPlan }} />
  }
  return (
    <div className="flex min-h-screen bg-muted/40 text-foreground">
      <Sidebar active={section} onSelect={(next) => setNav({ section: next, sectorId: null })} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          query={query}
          onQuery={setQuery}
          dark={dark}
          onTheme={() => setDark((value) => !value)}
          chatOpen={chatOpen}
          onChatToggle={() => {
            if (chatOpen) {
              closeChat()
            } else {
              openChat()
            }
          }}
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
        <main className="flex-1 px-4 py-6 md:px-6">
          <div
            key={section}
            className="mx-auto w-full max-w-6xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
          >
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mb-4 text-xl font-semibold focus:outline-none"
            >
              {heading}
            </h1>
            {!staging ? (
              <div className="rounded-xl border border-dashed border-border bg-background p-4">
                <p className="text-sm font-medium">Backend not connected.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Set the staging API URL and key, then reload. No sample data is shown.
                </p>
              </div>
            ) : section === 'Overview' ? (
              <Dashboard
                query={query}
                onClearSearch={() => setQuery('')}
                onViewAll={goResearches}
                onOpenSector={goSector}
                sectors={sectors}
                companies={companies}
              />
            ) : section === 'Researches' ? (
              <ResearchesPage
                key={researchTab}
                initialTab={researchTab}
                sectors={sectors}
                staging={staging}
                creating={creating}
                createError={createError}
                onBack={() => setNav({ section: 'Overview', sectorId: null })}
                onTabChange={(tab) => setNav({ researchTab: tab })}
                onOpenSector={goSector}
                onCreateSector={createDraftSector}
              />
            ) : section === 'SectorDetail' || section === 'SectorChat' ? (
              <SectorLanding
                key={sectorId}
                sector={detailData.detail}
                status={detailData.status}
                config={staging}
                progress={progress}
                onOpen={() => setNav({ section: 'SectorChat', sessionId: null, threadKey: null })}
                onRetry={detailData.retry}
                onBack={() => setNav({ section: 'Researches', sectorId: null })}
              />
            ) : section === 'Agents' ? (
              <RunsPanel
                config={staging}
                onBack={() => setNav({ section: 'Overview', sectorId: null })}
              />
            ) : section === 'Models' ? (
              <ModelsPanel
                config={staging}
                onBack={() => setNav({ section: 'Overview', sectorId: null })}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-background p-4">
                <p className="text-sm font-medium">Email tracking is not connected yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Outreach records will appear here once email tracking lands.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
