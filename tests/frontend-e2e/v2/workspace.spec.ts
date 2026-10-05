// Stage 4 workspace chrome (WS-01..10, SA-02, SO-01/02): rails, session
// list, header, tabs, subagent strip, directory, rename/delete. Rail shots
// open the sessions drawer at 390 so both widths show the subject.
import { expect, test, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'
import { extraChats } from '../support/fixtures'

interface GotoOptions {
  api?: ApiOptions
  extra?: string
  served?: boolean
}

async function gotoWorkspace(page: Page, sectorId: string, options: GotoOptions = {}): Promise<void> {
  if (!options.served) await serveApi(page, options.api ?? {})
  await page.goto(`/?section=SectorChat&sector=${sectorId}${options.extra ?? ''}`)
  // Below 768px the session rail lives in a drawer: the tablist is hidden
  // until the test opens it, so assert the drawer trigger instead.
  const width = page.viewportSize()?.width ?? 1440
  if (width >= 768) {
    await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
  } else {
    await expect(page.getByRole('button', { name: 'Open sessions' })).toBeVisible()
  }
  await expect(page.locator('main h1')).toBeVisible()
}

/** At <768px the session rail lives in a drawer; open it there, no-op above. */
async function openSessionsDrawerIfNeeded(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Open sessions' })
  if (await trigger.isVisible()) await trigger.click()
  await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
}

async function openChats(page: Page): Promise<void> {
  await openSessionsDrawerIfNeeded(page)
  await page.getByRole('tab', { name: /^Chats/ }).click()
  await expect(page.getByRole('list', { name: 'Chat sessions' })).toBeVisible()
}

test('WS-01-default', async ({ page }) => {
  await capture(page, 'WS-01', 'default', () => gotoWorkspace(page, 'sector-electrical'), undefined, { widths: [1440] })
})

test('WS-01-1280', async ({ page }) => {
  await capture(
    page, 'WS-01', '1280',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await expect(page.getByRole('button', { name: 'Open files and global context' })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Sector resources' })).toBeHidden()
    },
    { widths: [1280] },
  )
})

test('WS-01-1279-drawer-open', async ({ page }) => {
  await capture(
    page, 'WS-01', '1279-drawer-open',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: 'Open files and global context' }).click()
      await expect(page.getByRole('dialog', { name: 'Files and global context' })).toBeVisible()
    },
    { widths: [1279] },
  )
})

test('WS-01-768', async ({ page }) => {
  await capture(
    page, 'WS-01', '768',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await expect(page.getByRole('complementary', { name: 'Sector sessions' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Open files and global context' })).toBeVisible()
    },
    { widths: [768] },
  )
})

test('WS-01-767-sessions-drawer', async ({ page }) => {
  await capture(
    page, 'WS-01', '767-sessions-drawer',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: 'Open sessions' }).click()
      await expect(page.getByRole('dialog', { name: 'Sessions' })).toBeVisible()
    },
    { widths: [767] },
  )
})

test('WS-01-390', async ({ page }) => {
  await capture(page, 'WS-01', '390', () => gotoWorkspace(page, 'sector-electrical'), undefined, { widths: [390] })
})

test('WS-01-rail-hidden', async ({ page }) => {
  await capture(
    page, 'WS-01', 'rail-hidden',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      // Idempotent: the hidden choice persists across theme combos.
      const hide = page.getByRole('button', { name: 'Hide files and context' })
      if (await hide.isVisible()) await hide.click()
      await expect(page.getByRole('button', { name: 'Show files and context' })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-02-default', async ({ page }) => {
  await capture(
    page, 'WS-02', 'default',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openSessionsDrawerIfNeeded(page)
      await expect(page.getByRole('button', { name: 'Back to sector summary' })).toBeVisible()
    },
  )
})

test('WS-02-long-name', async ({ page }) => {
  await capture(
    page, 'WS-02', 'long-name',
    () => gotoWorkspace(page, 'sector-long'),
    () => openSessionsDrawerIfNeeded(page),
  )
})

test('WS-03-research', async ({ page }) => {
  await capture(
    page, 'WS-03', 'research',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openSessionsDrawerIfNeeded(page)
      await expect(page.getByRole('tab', { name: 'Research', selected: true })).toBeVisible()
    },
  )
})

test('WS-03-chats', async ({ page }) => {
  await capture(
    page, 'WS-03', 'chats',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      await expect(page.getByRole('tab', { name: /^Chats/, selected: true })).toBeVisible()
    },
  )
})

test('WS-03-tab-labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoWorkspace(page, 'sector-electrical')
  // One contiguous label node: split nodes become flex items with gaps.
  const chats = page.getByRole('tab', { name: 'Chats (6)' })
  await expect(chats).toBeVisible()
  const label = chats.locator('span.tabular-nums')
  await expect(label).toHaveText('Chats (6)')
  expect(await label.evaluate((node) => node.childNodes.length)).toBe(1)
  // Elevated selected thumb, on the active tab only.
  const research = page.getByRole('tab', { name: 'Research', selected: true })
  await expect(research.locator('[data-slot="tab-indicator"]')).toHaveClass(/bg-surface-raised/)
  await expect(research.locator('[data-slot="tab-indicator"]')).toHaveClass(/border-border/)
  await chats.click()
  const active = page.getByRole('tab', { name: 'Chats (6)', selected: true })
  await expect(active.locator('[data-slot="tab-indicator"]')).toHaveClass(/bg-surface-raised/)
})

test('WS-04-default', async ({ page }) => {
  await capture(page, 'WS-04', 'default', () => gotoWorkspace(page, 'sector-electrical'), () => openChats(page))
})

test('WS-04-hover', async ({ page }) => {
  await capture(
    page, 'WS-04', 'hover',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      await page.getByRole('list', { name: 'Chat sessions' }).getByRole('button').first().hover()
    },
  )
})

test('WS-04-selected', async ({ page }) => {
  await capture(
    page, 'WS-04', 'selected',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      await page.getByRole('button', { name: 'Open Compare the Parramatta installers' }).click()
      await expect(page.locator('main h1:has-text("Compare the Parramatta installers")')).toBeVisible()
      // Selecting closes the sessions drawer below 768px; scope to the
      // always-mounted inline rail so this never lands on the drawer's
      // frozen exit copy (nor the hidden twin ambiguity role queries hit).
      const activeRow = page.locator('aside[aria-label="Sector sessions"] button[aria-label="Open Compare the Parramatta installers"]')
      await expect(activeRow).toHaveAttribute('aria-current', 'page')
      await expect(activeRow).toHaveClass(/bg-surface-raised/)
      await expect(activeRow).toHaveClass(/border-border-strong/)
    },
  )
})

test('WS-04-menu-open', async ({ page }) => {
  await capture(
    page, 'WS-04', 'menu-open',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      const row = page.getByRole('button', { name: 'Open Brainstorm search directions' })
      await row.hover()
      await page.getByRole('button', { name: 'Options for Brainstorm search directions' }).click()
      await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    },
  )
})

test('WS-04-empty', async ({ page }) => {
  await capture(
    page, 'WS-04', 'empty',
    () => gotoWorkspace(page, 'sector-electrical', { api: { modes: { sessions: 'empty' } } }),
    async () => {
      // No list renders when empty: open the tab without openChats'
      // list assertion.
      await openSessionsDrawerIfNeeded(page)
      await page.getByRole('tab', { name: /^Chats/ }).click()
      // Role query: the rail and the drawer both mount the empty copy and
      // getByText would match the hidden one too.
      await expect(page.getByRole('heading', { name: 'No chats yet' })).toBeVisible()
    },
  )
})

test('WS-04-many', async ({ page }) => {
  await capture(
    page, 'WS-04', 'many',
    () => gotoWorkspace(page, 'sector-electrical', { api: { data: { sessions: extraChats('sector-electrical', 114) } } }),
    async () => {
      await openChats(page)
      await expect(page.getByRole('button', { name: 'Show more (50 of 120)' })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-04-long-titles', async ({ page }) => {
  await capture(
    page, 'WS-04', 'long-titles',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      await expect(page.getByRole('list', { name: 'Chat sessions' }).getByRole('button').last()).toBeVisible()
    },
  )
})

test('WS-05-pending', async ({ page }) => {
  await serveApi(page)
  await page.route('**/v1/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise((resolve) => setTimeout(resolve, 5000))
    await route.fallback().catch(() => undefined)
  })
  await capture(
    page, 'WS-05', 'pending',
    () => gotoWorkspace(page, 'sector-electrical', { served: true }),
    async () => {
      await openChats(page)
      await page.getByRole('button', { name: 'New chat' }).click()
      await expect(page.getByRole('button', { name: 'New chat' })).toBeDisabled()
    },
    { widths: [1440] },
  )
})

test('WS-06-filtered', async ({ page }) => {
  await capture(
    page, 'WS-06', 'filtered',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      await page.getByRole('textbox', { name: 'Search chats' }).fill('parramatta')
      await expect(page.getByRole('button', { name: 'Open Compare the Parramatta installers' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Open Brainstorm search directions' })).toBeHidden()
    },
  )
})

test('WS-07-draft', async ({ page }) => {
  await capture(
    page, 'WS-07', 'draft',
    () => gotoWorkspace(page, 'sector-foods'),
    async () => {
      await expect(page.getByRole('button', { name: 'Create plan' })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-07-planned', async ({ page }) => {
  await capture(
    page, 'WS-07', 'planned',
    () => gotoWorkspace(page, 'sector-plumbing'),
    async () => {
      await expect(page.getByRole('button', { name: 'Review plan' })).toBeVisible()
      await expect(page.getByText('needs approval')).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-07-approved', async ({ page }) => {
  await capture(
    page, 'WS-07', 'approved',
    () => gotoWorkspace(page, 'sector-hvac'),
    async () => {
      await expect(page.getByRole('button', { name: 'Start research' })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-07-running', async ({ page }) => {
  await capture(
    page, 'WS-07', 'running',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-07-paused', async ({ page }) => {
  await capture(
    page, 'WS-07', 'paused',
    () => gotoWorkspace(page, 'sector-solar'),
    async () => {
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-07-chat', async ({ page }) => {
  await capture(
    page, 'WS-07', 'chat',
    () => gotoWorkspace(page, 'sector-electrical', { extra: '&session=session-sector-electrical-chat-1' }),
    async () => {
      await expect(page.locator('main h1:has-text("Brainstorm search directions")')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Pause' })).toBeHidden()
    },
  )
})

test('WS-07-subagent', async ({ page }) => {
  await capture(
    page, 'WS-07', 'subagent',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: 'View all 6' }).click()
      await page.getByRole('button', { name: 'Open Research agent 1' }).click()
      await expect(page.getByRole('button', { name: 'Back to parent conversation' })).toBeVisible()
      await expect(page.getByText('Subagent of Research')).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-07-390', async ({ page }) => {
  await capture(page, 'WS-07', '390', () => gotoWorkspace(page, 'sector-electrical'), undefined, { widths: [390] })
})

test('WS-08-chat', async ({ page }) => {
  await capture(
    page, 'WS-08', 'chat',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await expect(page.getByRole('tab', { name: 'Chat', selected: true })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-08-plan', async ({ page }) => {
  await capture(
    page, 'WS-08', 'plan',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await page.getByRole('tab', { name: 'Plan' }).click()
      await expect(page.getByRole('tab', { name: 'Plan', selected: true })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-08-needs-approval', async ({ page }) => {
  await capture(
    page, 'WS-08', 'needs-approval',
    () => gotoWorkspace(page, 'sector-plumbing'),
    async () => {
      await expect(page.getByText('needs approval')).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-09-default', async ({ page }) => {
  await capture(
    page, 'WS-09', 'default',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await expect(page.getByRole('button', { name: 'View all 6' })).toBeVisible()
      // No clipped chip labels: every chip's text is fully inside its box.
      for (const chip of await page.getByRole('button', { name: /Research agent/ }).all()) {
        const box = await chip.boundingBox()
        const textWidth = await chip.evaluate((el) => (el as HTMLElement).scrollWidth)
        expect(box).not.toBeNull()
        expect(textWidth).toBeLessThanOrEqual((box?.width ?? 0) + 1)
      }
    },
  )
})

test('WS-09-many', async ({ page }) => {
  await capture(
    page, 'WS-09', 'many',
    () => gotoWorkspace(page, 'sector-electrical', { api: { data: { subagents: 12 } } }),
    async () => {
      await expect(page.getByRole('button', { name: 'View all 12' })).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('WS-10-error', async ({ page }) => {
  await capture(
    page, 'WS-10', 'error',
    () => gotoWorkspace(page, 'sector-electrical', { extra: '&session=session-bogus' }),
    async () => {
      await expect(page.getByRole('alert')).toContainText('not available in this sector')
    },
  )
})

test('SA-02-open', async ({ page }) => {
  await capture(
    page, 'SA-02', 'open',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: 'View all 6' }).click()
      const dialog = page.getByRole('dialog', { name: 'Subagents' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('Showing 6 of 6')).toBeVisible()
    },
  )
})

test('SA-02-filtered', async ({ page }) => {
  await capture(
    page, 'SA-02', 'filtered',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: 'View all 6' }).click()
      const dialog = page.getByRole('dialog', { name: 'Subagents' })
      await dialog.getByRole('textbox', { name: 'Search subagents' }).fill('agent 1')
      await expect(dialog.getByText('Showing 1 of 1')).toBeVisible()
    },
  )
})

test('SO-01', async ({ page }) => {
  await capture(
    page, 'SO-01', 'default',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      await page.getByRole('button', { name: 'Open Brainstorm search directions' }).hover()
      await page.getByRole('button', { name: 'Options for Brainstorm search directions' }).click()
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      await expect(page.getByRole('dialog', { name: 'Rename chat' })).toBeVisible()
    },
  )
})

test('SO-02', async ({ page }) => {
  await capture(
    page, 'SO-02', 'default',
    () => gotoWorkspace(page, 'sector-electrical'),
    async () => {
      await openChats(page)
      await page.getByRole('button', { name: 'Open Brainstorm search directions' }).hover()
      await page.getByRole('button', { name: 'Options for Brainstorm search directions' }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await expect(page.getByRole('alertdialog', { name: 'Delete "Brainstorm search directions"?' })).toBeVisible()
    },
  )
})
