// Stage 2-3 style audit: Overview + Researches + sector landing, every
// state x theme x 1440/390 (+ a coarse-pointer mobile context for the
// 40px touch floor). Alignment is enabled now that SH-01 owns the page
// frame; Researches aligns h1 against the tab list (its first
// full-width row), the landing against its status section. Landing
// audits use the paused sector so the 5s live poll cannot re-render
// mid-check.
import { devices, expect, test, type Browser, type Page } from '@playwright/test'
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
  for (const settled of view.anchors) await expect(page.locator(settled)).toBeVisible()
  await shot(page, `${view.shotPrefix}-${view.state}`, 'default', { anchors: view.anchors })

  for (const theme of THEMES) {
    await settleTheme(page, theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      // Settle the 180ms sidebar width transition: measuring mid-flight
      // reports a phantom ~24px overflow (real users see the animation).
      await page.waitForTimeout(250)
      if (view.state === 'loading') {
        await page.goto(view.url)
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
