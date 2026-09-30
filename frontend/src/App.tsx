import { useEffect, useRef, useState } from 'react'
import { ChatPanel, type ChatScope } from './components/ChatPanel'
import { Dashboard, type ResearchList } from './components/Dashboard'
import { ModelsPanel } from './components/ModelsPanel'
import { ResearchesPage } from './components/ResearchesPage'
import { RunsPanel } from './components/RunsPanel'
import { SectorDetailPage, type AttachResult } from './components/SectorDetailPage'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import {
  useStagingCompanies,
  useStagingSectorDetail,
  useStagingSectors,
} from './data/research'
import {
  approveSectorPlan,
  attachSectorDocument,
  createSector,
  listSectorDocuments,
  pauseSector,
  planSector,
  restartSector,
  resumeSector,
  startSector,
  updateSectorPlan,
  stagingConfig,
  type SectorDocumentSummary,
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
  const section = nav.section === 'Researches' || nav.section === 'SectorDetail' || nav.section === 'Agents' || nav.section === 'Models' || nav.section === 'Emails'
    ? nav.section
    : 'Overview'
  const sectorId = section === 'SectorDetail' ? nav.sectorId : null
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(false)
  const [chatScope, setChatScope] = useState<ChatScope>(null)
  const [researchBusy, setResearchBusy] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<SectorDocumentSummary[]>([])
  const [documentsFailed, setDocumentsFailed] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [attachingName, setAttachingName] = useState<string | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [attachResult, setAttachResult] = useState<AttachResult | null>(null)
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

  async function restartCurrentSector() {
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await restartSector(staging, sectorId)
      detailData.refresh()
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Restart failed.')
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
    if (!sectorId || !staging) return
    setResearchBusy(true)
    setResearchError(null)
    try {
      await updateSectorPlan(staging, sectorId, markdown)
      detailData.refresh()
    } catch (error: unknown) {
      setResearchError(error instanceof Error ? error.message : 'Plan edit failed.')
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

  // Context documents follow the open sector; resets happen during render
  // (ChatPanel sessionQuery pattern) so the effect only fetches. A failed
  // list keeps the section visible with an error instead of hiding attach.
  const documentsKey = staging && sectorId ? `${sectorId} ${detailData.detail?.updatedAt ?? ''}` : null
  const [activeDocumentsKey, setActiveDocumentsKey] = useState<string | null>(null)
  if (activeDocumentsKey !== documentsKey) {
    setActiveDocumentsKey(documentsKey)
    setDocuments([])
    setDocumentsFailed(false)
  }
  useEffect(() => {
    if (!staging || !sectorId) {
      return
    }
    let live = true
    listSectorDocuments(staging, sectorId).then(
      (rows) => {
        if (!live) return
        setDocuments(rows)
        setDocumentsFailed(false)
      },
      () => {
        if (!live) return
        setDocumentsFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [staging, sectorId, detailData.detail?.updatedAt])

  async function attachContextFile(file: File) {
    if (!staging || !sectorId || attaching) return
    setAttaching(true)
    setAttachingName(file.name)
    setAttachError(null)
    setAttachResult(null)
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '')
        reader.onerror = () => reject(new Error('could not read file'))
        reader.readAsDataURL(file)
      })
      const attached = await attachSectorDocument(staging, sectorId, { filename: file.name, contentBase64 })
      setAttachResult({
        filename: attached.filename,
        status: attached.status,
        unitCount: attached.unitCount ?? 0,
        ...(attached.detail ? { detail: attached.detail } : {}),
      })
      setDocuments(await listSectorDocuments(staging, sectorId))
      setDocumentsFailed(false)
    } catch (error: unknown) {
      setAttachError(error instanceof Error ? error.message : 'Attach failed.')
    } finally {
      setAttaching(false)
      setAttachingName(null)
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
            ) : section === 'SectorDetail' ? (
              <SectorDetailPage
                key={sectorId}
                detail={detailData.detail}
                status={detailData.status}
                documents={documents}
                documentsFailed={documentsFailed}
                attaching={attaching}
                attachingName={attachingName}
                attachError={attachError}
                attachResult={attachResult}
                researchBusy={researchBusy}
                researchError={researchError}
                staging={staging}
                onRetry={detailData.retry}
                onPauseResearch={pauseCurrentSector}
                onResumeResearch={resumeCurrentSector}
                onStartResearch={startCurrentSector}
                onRestartResearch={restartCurrentSector}
                onPlanResearch={planCurrentSector}
                onApproveResearch={approveCurrentSector}
                onEditResearchPlan={editCurrentSectorPlan}
                onAttach={attachContextFile}
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
