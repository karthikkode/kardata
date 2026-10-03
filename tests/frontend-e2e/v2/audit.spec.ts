// Stage 2-5 style audit: Overview + Researches + sector landing +
// workspace + Karbot dock + stage-5 plan/files/context surfaces, every
// state x theme x 1440/390 (+ a coarse-pointer mobile context for the
// 40px touch floor). Alignment is enabled now that SH-01 owns the page
// frame; Researches aligns h1 against the tab list (its first full-width
// row), the landing against its status section. Landing audits use the
// paused sector so the 5s live poll cannot re-render mid-check. Workspace
// views skip alignment (no SH-01 page frame: the h1 lives in the centre
// column) and offline (the shared offline anatomy is audited on the shell
// pages). Stage-5 views audit default states only: error/denied/offline
// share the ResourceNotice anatomy covered by the sessions-error views.
import { devices, expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { auditPage, formatViolations, writeAuditReport } from '../support/audit'
import { settleTheme, shot, shotPath, type ShotTheme } from '../support/shot'

const BASE = `http://127.0.0.1:${process.env.KARDATA_E2E_PORT ?? 5174}`
const THEMES: ShotTheme[] = ['light', 'dark']

interface ViewAudit {
  report: string
  shotPrefix: string
  url: string
  state: string
  options: ApiOptions
  anchors: string[]
  /** Null skips the h1 alignment check (no full-width row yet). */
  alignSelector: string | null
  offline?: boolean
  /** Runs after every goto (desktop, loading re-goto, mobile): opens the
   * dock/drawer or selects the tab the anchors need. Must be idempotent
   * across widths (check visibility before clicking drawer triggers). */
  interact?: (page: Page) => Promise<void>
}

/** Aborted fetch alone maps to error; the offline anatomy needs the
 * browser flag too (see apiErrorStatus), so refetch after going offline. */
async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true)
  for (let i = 0; i < 8; i++) {
    const retry = page.getByRole('button', { name: 'Try again' }).first()
    if ((await retry.count()) === 0) break
    await retry.click()
  }
}

async function auditView(page: Page, browser: Browser, view: ViewAudit): Promise<void> {
  // Anchors must prove the state SETTLED: h1 alone is visible during
  // loading, which once let an empty-mode hang pass as "empty".
  const anchor = view.anchors[0] as string
  await serveApi(page, { ...view.options, loadingMs: 20_000 })
  await page.goto(view.url)
  if (view.offline) {
    await expect(page.getByRole('alert').first()).toBeVisible()
    await goOffline(page)
  }
  if (view.interact) await view.interact(page)
  for (const settled of view.anchors) await expect(page.locator(settled)).toBeVisible()
  await shot(page, `${view.shotPrefix}-${view.state}`, 'default', {
    anchors: view.anchors,
    ...(view.interact ? { prepare: (page: Page) => view.interact?.(page) } : {}),
  })

  for (const theme of THEMES) {
    await settleTheme(page, theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      // Settle the 180ms sidebar width transition: measuring mid-flight
      // reports a phantom ~24px overflow (real users see the animation).
      await page.waitForTimeout(250)
      if (view.state === 'loading') {
        await page.goto(view.url)
        if (view.interact) await view.interact(page)
        await expect(page.locator(anchor)).toBeVisible()
        await settleTheme(page, theme)
      }
      const skip = [
        ...(width === 390 ? ['targets'] : []),
        ...(view.alignSelector === null ? ['alignment'] : []),
      ]
      const result = await auditPage(page, {
        skip,
        ...(view.alignSelector ? { sectionSelector: view.alignSelector } : {}),
      })
      const report = await writeAuditReport(`${view.report}-${view.state}-${theme}-${width}`, result)
      expect(result.violations, `${report}\n${formatViolations(result)}`).toEqual([])
    }
  }

  // A real device descriptor: hand-rolled { has_touch, is_mobile } does
  // NOT match (pointer: coarse) in headless Chromium, the descriptor does.
  const context = await browser.newContext({ ...devices['iPhone 12'], baseURL: BASE })
  const mpage = await context.newPage()
  try {
    await serveApi(mpage, { ...view.options, loadingMs: 20_000 })
    for (const theme of THEMES) {
      // Offline views go offline below; restore connectivity first so the
      // second theme's goto does not hit ERR_INTERNET_DISCONNECTED.
      if (view.offline) await mpage.context().setOffline(false)
      await mpage.emulateMedia({ colorScheme: theme })
      await mpage.goto(view.url)
      if (view.offline) {
        await expect(mpage.getByRole('alert').first()).toBeVisible()
        await goOffline(mpage)
      }
      if (view.interact) await view.interact(mpage)
      await expect(mpage.locator(anchor)).toBeVisible()
      await settleTheme(mpage, theme)
      const coarse = await mpage.evaluate(() => window.matchMedia('(pointer: coarse)').matches)
      expect(coarse, 'mobile context must emulate a coarse pointer').toBe(true)
      await mpage.screenshot({ path: shotPath(`${view.shotPrefix}-${view.state}`, 'mobile', theme, 390), animations: 'disabled' })
      const result = await auditPage(mpage, {
        skip: view.alignSelector === null ? ['alignment'] : [],
        ...(view.alignSelector ? { sectionSelector: view.alignSelector } : {}),
      })
      const report = await writeAuditReport(`${view.report}-${view.state}-${theme}-390-mobile`, result)
      expect(result.violations, `${report}\n${formatViolations(result)}`).toEqual([])
    }
  } finally {
    await context.close()
  }
}

const OVERVIEW = { report: 'overview', shotPrefix: 'OV-audit', url: '/', alignSelector: '[data-page-section], section' } as const

test('audit-overview-default', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...OVERVIEW, alignSelector: '[data-page-section], section', state: 'default', options: {},
    anchors: ['[aria-label^="Sectors:"]', 'section[aria-label="Recent sectors"]', 'section[aria-label="Recent companies"]'],
  })
})

test('audit-overview-loading', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...OVERVIEW, alignSelector: '[data-page-section], section', state: 'loading',
    options: { modes: { sectors: 'loading', companies: 'loading' } },
    anchors: ['[aria-label="Sectors is loading"]', '[aria-label="Recent sectors is loading"]', '[aria-label="Recent companies is loading"]'],
  })
})

test('audit-overview-empty', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...OVERVIEW, alignSelector: '[data-page-section], section', state: 'empty',
    options: { modes: { sectors: 'empty', companies: 'empty' } },
    anchors: ['text=No sectors yet', 'text=No companies yet'],
  })
})

test('audit-overview-error', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...OVERVIEW, alignSelector: '[data-page-section], section', state: 'error',
    options: { modes: { sectors: 'error', companies: 'error' } },
    anchors: ['section[aria-label="Recent sectors"] [role="alert"]', 'section[aria-label="Recent companies"] [role="alert"]'],
  })
})

test('audit-overview-denied', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...OVERVIEW, alignSelector: '[data-page-section], section', state: 'denied',
    options: { modes: { sectors: 'denied', companies: 'denied' } },
    anchors: ['section[aria-label="Recent sectors"] [role="alert"]', 'section[aria-label="Recent companies"] [role="alert"]'],
  })
})

test('audit-overview-offline', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...OVERVIEW, alignSelector: '[data-page-section], section', state: 'offline', offline: true,
    options: { modes: { sectors: 'offline', companies: 'offline' } },
    anchors: ['text=You are offline'],
  })
})

const SECTORS_TAB = {
  report: 'researches-sectors', shotPrefix: 'RS-sectors-audit',
  url: '/?section=Researches', alignSelector: '[role="tablist"]',
} as const

test('audit-researches-sectors-default', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...SECTORS_TAB, state: 'default', options: {},
    anchors: ['[role="tablist"]', 'table[aria-label="Sectors"]'],
  })
})

test('audit-researches-sectors-loading', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...SECTORS_TAB, state: 'loading',
    options: { modes: { sectors: 'loading' } },
    anchors: ['[aria-label="Sectors are loading"]'],
  })
})

test('audit-researches-sectors-empty', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...SECTORS_TAB, state: 'empty',
    options: { modes: { sectors: 'empty' } },
    anchors: ['text=No sectors yet'],
  })
})

test('audit-researches-sectors-error', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...SECTORS_TAB, state: 'error',
    options: { modes: { sectors: 'error' } },
    anchors: ['table[aria-label="Sectors"] [role="alert"]'],
  })
})

test('audit-researches-sectors-denied', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...SECTORS_TAB, state: 'denied',
    options: { modes: { sectors: 'denied' } },
    anchors: ['text=Access denied'],
  })
})

test('audit-researches-sectors-offline', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...SECTORS_TAB, state: 'offline', offline: true,
    options: { modes: { sectors: 'offline' } },
    anchors: ['text=You are offline'],
  })
})

const COMPANIES_TAB = {
  report: 'researches-companies', shotPrefix: 'RS-companies-audit',
  url: '/?section=Researches&tab=companies', alignSelector: '[role="tablist"]',
} as const

test('audit-researches-companies-default', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...COMPANIES_TAB, state: 'default', options: {},
    anchors: ['[role="tablist"]', 'table[aria-label="Companies"]'],
  })
})

test('audit-researches-companies-loading', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...COMPANIES_TAB, state: 'loading',
    options: { modes: { companies: 'loading' } },
    anchors: ['[aria-label="Companies are loading"]'],
  })
})

test('audit-researches-companies-empty', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...COMPANIES_TAB, state: 'empty',
    options: { modes: { companies: 'empty' } },
    anchors: ['text=No companies yet'],
  })
})

test('audit-researches-companies-error', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...COMPANIES_TAB, state: 'error',
    options: { modes: { companies: 'error' } },
    anchors: ['table[aria-label="Companies"] [role="alert"]'],
  })
})

test('audit-researches-companies-denied', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...COMPANIES_TAB, state: 'denied',
    options: { modes: { companies: 'denied' } },
    anchors: ['text=Access denied'],
  })
})

test('audit-researches-companies-offline', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...COMPANIES_TAB, state: 'offline', offline: true,
    options: { modes: { companies: 'offline' } },
    anchors: ['text=You are offline'],
  })
})

const LANDING = {
  report: 'landing', shotPrefix: 'SL-audit',
  url: '/?section=SectorDetail&sector=sector-solar',
  alignSelector: 'section[aria-label="Research status"]',
} as const

test('audit-landing-default', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...LANDING, state: 'default', options: {},
    anchors: ['h1:has-text("Brisbane solar installers")', 'section[aria-label="Research status"]', 'table[aria-label="Companies"]'],
  })
})

test('audit-landing-loading', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...LANDING, alignSelector: null, state: 'loading',
    options: { modes: { sector: 'loading' } },
    anchors: ['[aria-label="Sector is loading"]'],
  })
})

test('audit-landing-empty', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...LANDING, state: 'empty',
    options: { modes: { companies: 'empty' } },
    anchors: ['section[aria-label="Research status"]', 'text=No companies yet'],
  })
})

test('audit-landing-error', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...LANDING, alignSelector: null, state: 'error',
    options: { modes: { sector: 'error' } },
    anchors: ['[role="alert"]'],
  })
})

test('audit-landing-denied', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...LANDING, alignSelector: null, state: 'denied',
    options: { modes: { sector: 'denied' } },
    anchors: ['text=Access denied'],
  })
})

test('audit-landing-offline', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...LANDING, alignSelector: null, state: 'offline', offline: true,
    options: { modes: { sector: 'offline', companies: 'offline' } },
    anchors: ['text=You are offline'],
  })
})

test('audit-landing-notfound', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...LANDING, url: '/?section=SectorDetail&sector=sector-removed', alignSelector: null, state: 'notfound',
    options: {},
    anchors: ['text=This sector may have been removed.'],
  })
})

// Stage 4: the workspace header always renders its h1 (falling back to
// "Sector workspace") and the conversation log + composer mount at every
// width, so these anchors hold on desktop and in the mobile drawer.

/** Below 768px the session rail lives in a drawer; open it there,
 * and close it at desktop widths (prepare replays per width, so a drawer
 * opened for 390 would otherwise linger over the 1440 audit). */
async function openSessionsDrawer(page: Page): Promise<void> {
  // interact runs straight after goto: settle on the header first or the
  // trigger check below races first render (and fails as "not found").
  await expect(page.locator('main h1')).toBeVisible()
  const drawer = page.getByRole('dialog', { name: 'Sessions' })
  if ((page.viewportSize()?.width ?? 1440) >= 768) {
    if (await drawer.isVisible()) await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
    return
  }
  // Width-based branch, not isVisible(): on the touch context the
  // trigger reports hidden for a beat after the h1 settles (entrance
  // motion), which skipped the click and failed as "tablist not found".
  // click() actionability-waits instead. Probe: unconditional click on the
  // "hidden" trigger opens the drawer (zz-debug-drawer).
  await page.getByRole('button', { name: 'Open sessions' }).click()
  await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
}

async function selectFirstChat(page: Page): Promise<void> {
  await openSessionsDrawer(page)
  await page.getByRole('tab', { name: /^Chats/ }).click()
  const list = page.getByRole('list', { name: 'Chat sessions' })
  await expect(list).toBeVisible()
  const first = list.getByRole('button', { name: /^Open / }).first()
  const title = ((await first.getAttribute('aria-label')) ?? '').replace(/^Open /, '')
  expect(title.length, 'first chat must have a title').toBeGreaterThan(0)
  await first.click()
  await expect(page.locator('main h1')).toContainText(title)
}

async function openKarbot(page: Page): Promise<void> {
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Research totals' })).toBeVisible()
  // The TopBar toggle closes an open dock: only click when it is absent so
  // per-width replays keep the dock open.
  if ((await page.getByRole('complementary', { name: 'Assistant chat' }).count()) === 0) {
    await page.getByRole('button', { name: 'Ask Karbot' }).click()
  }
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
}

const WORKSPACE = {
  report: 'workspace', shotPrefix: 'WS-audit',
  url: '/?section=SectorChat&sector=sector-electrical',
  alignSelector: null,
} as const

const WORKSPACE_SETTLED = ['main h1', '[aria-label="Conversation messages"]', 'role=textbox[name="Message this conversation"]']

test('audit-workspace-default', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...WORKSPACE, state: 'default', options: {},
    anchors: WORKSPACE_SETTLED,
  })
})

test('audit-workspace-chat', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...WORKSPACE, state: 'chat', options: {},
    interact: selectFirstChat,
    anchors: WORKSPACE_SETTLED,
  })
})

test('audit-workspace-error', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...WORKSPACE, url: '/?section=SectorChat&sector=sector-electrical&session=session-bogus', state: 'error',
    options: {},
    anchors: ['main h1', '[role="alert"]'],
  })
})

test('audit-workspace-sessions-loading', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...WORKSPACE, state: 'sessions-loading',
    options: { modes: { sessions: 'loading' } },
    interact: openSessionsDrawer,
    anchors: ['main h1', '[aria-label="Sessions is loading"]'],
  })
})

test('audit-workspace-sessions-error', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...WORKSPACE, state: 'sessions-error',
    options: { modes: { sessions: 'error' } },
    interact: openSessionsDrawer,
    anchors: ['main h1', '[role="alert"]'],
  })
})

test('audit-workspace-sessions-denied', async ({ page, browser }) => {
  await auditView(page, browser, {
    ...WORKSPACE, state: 'sessions-denied',
    options: { modes: { sessions: 'denied' } },
    interact: openSessionsDrawer,
    anchors: ['main h1', 'text=Access denied'],
  })
})

test('audit-karbot-open', async ({ page, browser }) => {
  // Six combos over Overview + the open dock outgrows the 30s default.
  test.setTimeout(120_000)
  await auditView(page, browser, {
    report: 'karbot', shotPrefix: 'KB-audit', url: '/', alignSelector: null, state: 'open',
    options: {},
    interact: openKarbot,
    anchors: ['[aria-label="Assistant chat"]', 'role=textbox[name="Message the agent"]'],
  })
})

async function selectPlanTab(page: Page): Promise<void> {
  await expect(page.locator('main h1')).toBeVisible()
  const tab = page.getByRole('tab', { name: /^Plan/ })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(page.getByRole('heading', { name: 'Research plan' })).toBeVisible()
}

/** Below 1281px the files/context rail lives in a drawer; open it there,
 * and close it at desktop widths (an open drawer plus the inline rail
 * renders every anchor twice). Width-based like openSessionsDrawer. */
async function openResourcesDrawer(page: Page): Promise<void> {
  await expect(page.locator('main h1')).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Files and global context' })
  if ((page.viewportSize()?.width ?? 1440) >= 1281) {
    if (await dialog.isVisible()) await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('region', { name: 'Sector files' })).toBeVisible()
    return
  }
  if (await dialog.isVisible()) return
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  await expect(dialog).toBeVisible()
}

async function openLocalSheet(page: Page): Promise<void> {
  await expect(page.locator('main h1')).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Local context' })
  if (await dialog.isVisible()) return
  await page.getByRole('button', { name: 'Local context', exact: true }).click()
  await expect(dialog).toBeVisible()
}

async function openGlobalEditor(page: Page): Promise<void> {
  // Editor first: once it is open the rail behind it is inert, so the
  // drawer/region checks below would hang on later width replays.
  const editor = page.getByRole('dialog', { name: 'Edit global context' })
  if (await editor.isVisible()) return
  await openResourcesDrawer(page)
  const drawer = page.getByRole('dialog', { name: 'Files and global context' })
  const scope: Page | Locator = (await drawer.isVisible()) ? drawer : page
  await scope.getByRole('button', { name: 'Edit global context' }).click()
  await expect(editor).toBeVisible()
}

async function openInspector(page: Page): Promise<void> {
  // Inspector first: it inerts the Local context sheet behind it.
  const inspector = page.getByRole('dialog', { name: 'Execution records' })
  if (await inspector.isVisible()) return
  await openLocalSheet(page)
  await page.getByRole('dialog', { name: 'Local context' }).getByRole('button', { name: 'Execution records', exact: true }).click()
  await expect(inspector).toBeVisible()
}

test('audit-workspace-plan', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await auditView(page, browser, {
    ...WORKSPACE, report: 'workspace-plan', shotPrefix: 'PL-audit', state: 'plan',
    options: {},
    interact: selectPlanTab,
    anchors: ['main h1', 'role=heading[name="Research plan"]'],
  })
})

test('audit-workspace-files', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await auditView(page, browser, {
    ...WORKSPACE, report: 'workspace-files', shotPrefix: 'FL-audit', state: 'files',
    options: {},
    interact: openResourcesDrawer,
    // The inline rail and the drawer both render the rail; :visible picks
    // whichever copy the width shows (a hidden copy still resolves).
    anchors: ['main h1', 'p:text("Showing 10 of 10 files"):visible'],
  })
})

test('audit-workspace-global', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await auditView(page, browser, {
    ...WORKSPACE, report: 'workspace-global', shotPrefix: 'GC-audit', state: 'global',
    options: {},
    interact: openResourcesDrawer,
    anchors: ['main h1', 'span:text("2 updates waiting for review"):visible'],
  })
})

test('audit-workspace-gc-edit', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await auditView(page, browser, {
    ...WORKSPACE, report: 'workspace-gc-edit', shotPrefix: 'GC-audit-edit', state: 'gc-edit',
    options: {},
    interact: openGlobalEditor,
    anchors: ['role=dialog[name="Edit global context"]', 'role=button[name="Save context"]'],
  })
})

test('audit-workspace-local', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await auditView(page, browser, {
    ...WORKSPACE, report: 'workspace-local', shotPrefix: 'LC-audit', state: 'local',
    options: {},
    interact: openLocalSheet,
    anchors: ['main h1', 'role=textbox[name="Local notes"]'],
  })
})

test('audit-workspace-inspector', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await auditView(page, browser, {
    ...WORKSPACE, report: 'workspace-inspector', shotPrefix: 'LC-audit-inspector', state: 'inspector',
    options: {},
    interact: openInspector,
    anchors: ['main h1', 'text=20 entries'],
  })
})
