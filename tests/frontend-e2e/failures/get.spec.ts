// GET endpoint failure matrix (P6.4): 23 unary read endpoints x 9 faults
// (500/401/403/404/409/429/32s-timeout/abort/malformed). 19 verified cases
// assert the designed error/denied UI + retry + draft kept, then heal.
// 4 unverified (skills/artifacts/queue/references: no proven error UI)
// assert chrome intact + console clean + a grading shot, recorded for
// verification follow-up. Page-level offline
// (navigator) is covered per consumer below; per-endpoint abort while
// online maps to the error UI by apiErrorStatus design.
import { expect, test } from '@playwright/test'
import { serveApi } from '../support/api'
import { makeCompanies, makeSessions, matrixSector } from '../support/factory'
import { FAULTS, runFault, type FaultCase } from '../support/failures'
import { isFaultedResourceNoise } from '../support/matrix'

test.describe.configure({ timeout: 120_000 })

const DOCK = [{ click: { kind: 'role', role: 'button', name: 'Ask Karbot' } }] as const
const TRY_AGAIN = { kind: 'role', role: 'button', name: 'Try again' } as const
const DENIED_COPY = { kind: 'text', text: 'Ask an owner for access, then try again.' } as const
const CHAT = '/?section=SectorChat&sector=sector-matrix&session=mx-session-001&thread=mx-session-001'

const CASES: FaultCase[] = [
  {
    id: 'frontend.src.components.ResearchesPage', label: 'GET /v1/sectors', method: 'GET',
    pattern: /\/v1\/sectors(\?.*)?$/, route: '/?section=Researches',
    setup: [{ click: { kind: 'text', text: 'Sectors' } }],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'role', role: 'heading', name: 'Researches' },
      { kind: 'text', text: 'Matrix Trades' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    // Sector search filters client-side (useStagingSectors takes no
    // filters), so a fill cannot refetch; reload replays the faulted GET.
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.SectorLanding', label: 'GET /v1/sectors/:id', method: 'GET',
    pattern: /\/v1\/sectors\/[^/?]+$/, route: '/?section=SectorDetail&sector=sector-matrix',
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'role', role: 'region', name: 'Research status' },
      { kind: 'role', role: 'button', name: 'Open workspace' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.CompaniesSection', label: 'GET /v1/companies', method: 'GET',
    pattern: /\/v1\/companies/, route: '/?section=Researches',
    setup: [{ click: { kind: 'role', role: 'tab', name: 'Companies' } }],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'role', role: 'table', name: 'Companies' },
      { kind: 'text', text: 'Matrix Spark Electrical 1' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    draftFill: { kind: 'role', role: 'textbox', name: 'Search companies' }, draftText: 'Matrix',
    refetch: { steps: [{ fill: { kind: 'role', role: 'textbox', name: 'Search companies' }, text: 'Matrix S' }] },
  },
  {
    id: 'frontend.src.components.chat.SessionsPanel', label: 'GET /v1/sessions', method: 'GET',
    pattern: /\/v1\/sessions(\?.*)?$/, route: '/',
    setup: [...DOCK],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'text', text: 'Chat is not shared with this key.' }],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'role', role: 'log', name: 'Chat messages' },
    ],
    retry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.chat.ChatLog', label: 'GET /v1/sessions/:id/threads', method: 'GET',
    pattern: /\/v1\/sessions\/[^/]+\/threads/, route: '/',
    setup: [...DOCK],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'text', text: 'Chat is not shared with this key.' }],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'role', role: 'log', name: 'Chat messages' },
    ],
    retry: TRY_AGAIN,
    // No draftFill: the refetch opens another session, whose composer is
    // a different draft scope; drafts are pinned by same-surface cases.
    refetch: { steps: [
      { click: { kind: 'css', css: '[aria-label="Chat sessions"]' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Open What is running right now' } },
    ] },
  },
  {
    id: 'frontend.src.components.chat.ChatLog', label: 'GET /v1/threads/:key/messages', method: 'GET',
    pattern: /\/v1\/threads\/[^/]+\/messages/, route: '/',
    setup: [...DOCK],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'text', text: 'Chat is not shared with this key.' }],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'role', role: 'log', name: 'Chat messages' },
    ],
    retry: TRY_AGAIN,
    // No draftFill: the refetch opens another session, whose composer is
    // a different draft scope; drafts are pinned by same-surface cases.
    refetch: { steps: [
      { click: { kind: 'css', css: '[aria-label="Chat sessions"]' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Open What is running right now' } },
    ] },
  },
  {
    id: 'frontend.src.components.RunsPanel', label: 'GET /v1/runs', method: 'GET',
    pattern: /\/v1\/runs/, route: '/?section=Agents',
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'role', role: 'region', name: 'Runs' },
      { kind: 'role', role: 'table' },
    ],
    retry: TRY_AGAIN,
    draftFill: { kind: 'role', role: 'textbox', name: 'Search runs' }, draftText: 'mx-run',
    refetch: { steps: [{ fill: { kind: 'role', role: 'textbox', name: 'Search runs' }, text: 'mx-run-00' }] },
  },
  {
    id: 'frontend.src.components.ModelToolbar', label: 'GET /v1/providers', method: 'GET',
    pattern: /\/v1\/providers/, route: CHAT,
    errorAnchors: [{ kind: 'text', text: 'Models did not load.' }],
    deniedAnchors: [{ kind: 'text', text: 'Models are not shared with this key.' }],
    healAnchors: [{ kind: 'css', css: '[aria-label="Choose a model"]' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    // Panel-side providers failure: the catalog area degrades inline
    // while the session picker keeps working (partial rendering).
    id: 'frontend.src.components.ModelsPanel', label: 'GET /v1/providers panel', method: 'GET',
    pattern: /\/v1\/providers/, route: '/?section=Models',
    errorAnchors: [{ kind: 'text', text: 'The model catalog did not load.' }],
    deniedAnchors: [{ kind: 'text', text: 'The model catalog is not shared with this key.' }],
    errorContent: [{ kind: 'role', role: 'combobox' }],
    healAnchors: [
      { kind: 'role', role: 'region', name: 'Models' },
      { kind: 'text', text: 'Meta' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.chat.ChatComposer', label: 'GET /v1/skills', method: 'GET',
    pattern: /\/v1\/skills/, route: '/',
    setup: [...DOCK],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'role', role: 'textbox' },
    ],
    refetch: { reload: true },
    silent: true,
  },
  {
    id: 'frontend.src.components.chat.SessionFiles', label: 'GET session artifacts', method: 'GET',
    pattern: /\/artifacts/, route: '/',
    setup: [...DOCK],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'css', css: '[aria-label="Session files"]' },
    ],
    refetch: { reload: true },
    unverified: true,
  },
  {
    id: 'frontend.src.components.global_context_panel', label: 'GET global-context', method: 'GET',
    pattern: /\/global-context$/, route: CHAT,
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [{ kind: 'css', css: '[aria-label="Global context"]' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.workspace_files', label: 'GET sector files', method: 'GET',
    pattern: /\/files(\?.*)?$/, route: CHAT,
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [{ kind: 'css', css: '[aria-label="Sector files"]' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.SectorFilePreview', label: 'GET file body', method: 'GET',
    pattern: /\/files\/[^/]+\/body/, route: CHAT,
    setup: [{ click: { kind: 'text', text: 'parramatta-crew-notes.md' } }],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'text', text: 'File preview' },
      { kind: 'role', role: 'heading', name: 'parramatta-crew-notes.md' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { steps: [
      { press: 'Escape' },
      { click: { kind: 'text', text: 'parramatta-crew-notes.md' } },
    ] },
  },
  {
    id: 'frontend.src.components.local_context_editor', label: 'GET thread context', method: 'GET',
    pattern: /\/v1\/threads\/[^/]+\/context$/, route: CHAT,
    setup: [
      { click: { kind: 'role', role: 'button', name: 'Conversation options' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Local context' } },
    ],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [{ kind: 'text', text: 'Local context' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { steps: [
      { press: 'Escape' },
      { click: { kind: 'role', role: 'button', name: 'Conversation options' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Local context' } },
    ] },
  },
  {
    id: 'frontend.src.components.plan_progress', label: 'GET research progress', method: 'GET',
    pattern: /\/progress$/, route: '/?section=SectorChat&sector=sector-matrix&session=session-sector-matrix-research&thread=session-sector-matrix-research',
    setup: [{ click: { kind: 'role', role: 'tab', name: 'Plan' } }],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'role', role: 'tab', name: 'Plan' },
      { kind: 'role', role: 'region', name: 'Research progress' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.plan.PlanTab', label: 'GET sector plan', method: 'GET',
    pattern: /\/plan$/, route: '/?section=SectorChat&sector=sector-matrix&session=session-sector-matrix-research&thread=session-sector-matrix-research',
    setup: [{ click: { kind: 'role', role: 'tab', name: 'Plan' } }],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'role', role: 'tab', name: 'Plan' },
      { kind: 'role', role: 'region', name: 'Research progress' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.SupervisionAlertsPanel', label: 'GET /v1/alerts', method: 'GET',
    pattern: /\/v1\/alerts/, route: '/?section=Agents',
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [
      { kind: 'role', role: 'region', name: 'Alerts' },
      { kind: 'css', css: '[aria-label="Current warnings"]' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
  {
    id: 'frontend.src.components.ExecutionInspector', label: 'GET execution records', method: 'GET',
    pattern: /\/execution-records/, route: CHAT,
    setup: [
      { click: { kind: 'role', role: 'button', name: 'Conversation options' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Execution records' } },
    ],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [{ kind: 'role', role: 'dialog', name: 'Execution records' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { steps: [
      { press: 'Escape' },
      { click: { kind: 'role', role: 'button', name: 'Conversation options' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Execution records' } },
    ] },
  },
  {
    id: 'frontend.src.components.local_context_editor', label: 'GET operation receipt', method: 'GET',
    pattern: /\/operations\//, route: CHAT,
    apiData: { localVariant: 'pending' },
    setup: [
      { click: { kind: 'role', role: 'button', name: 'Conversation options' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Local context' } },
    ],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [{ kind: 'text', text: 'Local context' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { steps: [{ click: { kind: 'role', role: 'button', name: 'Inspect receipt' } }] },
  },
  {
    id: 'frontend.src.components.SectorWorkspace', label: 'GET thread queue', method: 'GET',
    pattern: /\/v1\/threads\/[^/]+\/queue$/, route: CHAT,
    healAnchors: [{ kind: 'css', css: '[aria-label="Conversation messages"]' }],
    refetch: { reload: true },
    unverified: true,
  },
  {
    id: 'frontend.src.components.chat.MessageBubble', label: 'GET artifact references', method: 'GET',
    pattern: /\/references/, route: '/',
    setup: [...DOCK],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'role', role: 'log', name: 'Chat messages' },
    ],
    refetch: { reload: true },
    unverified: true,
  },
  {
    id: 'frontend.src.components.ExecutionInspector', label: 'GET execution record', method: 'GET',
    pattern: /\/execution-records\/[^/]+$/, route: CHAT,
    setup: [
      { click: { kind: 'role', role: 'button', name: 'Conversation options' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Execution records' } },
    ],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [DENIED_COPY],
    healAnchors: [{ kind: 'role', role: 'dialog', name: 'Execution records' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { steps: [{ click: { kind: 'css', css: '[aria-label="Recorded boundaries"] button' } }] },
  },
  {
    id: 'frontend.src.components.ModelToolbar', label: 'GET /v1/sessions/:id', method: 'GET',
    pattern: /\/v1\/sessions\/[^/]+$/, route: CHAT,
    errorAnchors: [{ kind: 'text', text: 'The current model did not load.' }],
    deniedAnchors: [{ kind: 'text', text: 'The current model did not load.' }],
    healAnchors: [{ kind: 'css', css: '[aria-label="Choose a model"]' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { reload: true },
  },
]

for (const fc of CASES) {
  for (const fault of FAULTS) {
    test(`[F:${fc.id}] failure ${fc.label} ${fault}`, async ({ page }) => {
      await runFault(page, fc, fault)
    })
  }
}

// Page-level offline (navigator down): every consumer route shows a
// connection notice. Chrome anchors are skipped: offline UI replaces
// content by design, and the matrix already proves the chrome.
const OFFLINE_ROUTES: Array<{ label: string; route: string }> = [
  { label: 'overview', route: '/' },
  { label: 'researches', route: '/?section=Researches' },
  { label: 'agents', route: '/?section=Agents' },
  { label: 'models', route: '/?section=Models' },
  { label: 'detail', route: '/?section=SectorDetail&sector=sector-matrix' },
  { label: 'chat', route: CHAT },
]

for (const target of OFFLINE_ROUTES) {
  test(`[F:frontend.src.components.shells] offline ${target.label} shows connection notice`, async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      // Every API response here is faulted by design (offline modes plus
      // the browser flag), so the browser's own /v1/ resource errors drop.
      if (isFaultedResourceNoise(msg, /\/v1\//)) return
      errors.push(msg.text().slice(0, 300))
    })
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))
    await serveApi(page, {
      stream: 'static',
      modes: { sectors: 'offline', companies: 'offline', sessions: 'offline', runs: 'offline', alerts: 'offline', progress: 'offline', plan: 'offline', files: 'offline', global: 'offline' },
      data: { sectors: [matrixSector()], companies: makeCompanies(8), sessions: makeSessions(8) },
    })
    // Navigate online: with the context offline, goto itself fails and no
    // app UI ever renders. Load first (aborted fetch -> error UI with
    // retry), then drop the network and refetch into the offline anatomy.
    await page.goto(target.route)
    await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible({ timeout: 15000 })
    await page.context().setOffline(true)
    try {
      await page.getByRole('button', { name: 'Try again' }).first().click()
      await expect(page.getByText('No connection').first()).toBeVisible({ timeout: 15000 })
    } finally {
      await page.context().setOffline(false)
    }
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
  })
}
