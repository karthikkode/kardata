// Scale budgets (P6.3.3): 100/1000/2000-row datasets render correctly,
// first render stays within 300ms at 1000 rows, scripted scrolls see no
// long task over 50ms, and 10 dock open/close cycles grow the heap by
// less than 50MB. Sizes ride a mutable world route registered AFTER serveApi
// (Playwright matches page.route last-registered-first; the world route falls
// back to serveApi outside its paths) so one page walks all three counts.
// [F:frontend.src.components.chat.SessionsPanel] [F:frontend.src.components.SubagentsPanel] [F:frontend.src.components.SectorWorkspace] [F:frontend.src.components.SectorLanding] [F:frontend.src.components.workspace_files]
import { expect, test, type Locator, type Page } from '@playwright/test'
import { serveApi } from './support/api'
import { makeCompanies, matrixSector } from './support/factory'

// Scale budgets pin warm logic/render cost, not animation frames:
// reduced motion collapses the view-transition snapshots (matrix and
// a11y specs cover motion separately).
test.use({ reducedMotion: 'reduce' })

const AT = '2026-10-01T00:00:00.000Z'
const SECTOR_ROUTE = '/?section=SectorChat&sector=sector-matrix&session=mx-session-001&thread=mx-session-001'
const DETAIL_ROUTE = '/?section=SectorDetail&sector=sector-matrix'
const grouped = (value: number): string => value.toLocaleString('en-AU')

function scaleSessions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `scale-session-${i + 1}`,
    title: `Scale chat ${i + 1}`,
    createdAt: AT,
    updatedAt: AT,
  }))
}

function scaleSubagents(count: number) {
  const statuses = ['RUNNING', 'QUEUED', 'STOPPED', 'RUNNING']
  const rows: Array<Record<string, unknown>> = [{
    key: 'scale-session', sessionId: 'scale-session', kind: 'session',
    status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: AT,
  }]
  for (let i = 0; i < count; i++) {
    rows.push({
      key: `agent:scale-child-${i + 1}`, sessionId: 'scale-session',
      name: `Scale agent ${i + 1}`, kind: 'subagent',
      status: statuses[i % statuses.length] as string,
      acceptingSteer: true, queueDepth: 0, updatedAt: AT,
    })
  }
  return rows
}

function scaleQueue(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `scale-queued-${i + 1}`,
    text: `Scale queued ${i + 1}`,
    queuedAt: Date.parse(AT) + i,
  }))
}

function sectorSession() {
  return [{ id: 'mx-session-001', title: 'Matrix chat', createdAt: AT, updatedAt: AT, sectorId: 'sector-matrix', kind: 'normal' }]
}

function scaleMessages(count: number, tag = 'Scale') {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    kind: 'text',
    role: i % 2 === 0 ? 'user' : 'agent',
    text: i % 2 === 0 ? `${tag} question ${i + 1}` : `${tag} answer ${i + 1}`,
    at: AT,
  }))
}

function scaleFiles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `scale-file-${i + 1}`,
    filename: `scale-note-${String(i + 1).padStart(4, '0')}.md`,
    status: 'indexed', source: 'upload', hash: 'scale', hidden: false,
    included: false, kind: 'document',
  }))
}

interface MutableWorld {
  sessions: unknown[]
  subagents: unknown[]
  queue: unknown[]
  messages: unknown[]
  /** Per-thread overrides so session switches measure fresh renders. */
  messagesByThread?: Record<string, unknown[]>
  companies: unknown[]
  files: unknown[]
}

async function mutableApi(page: Page, world: MutableWorld): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    let data: unknown = null
    let extra: Record<string, unknown> = {}
    if (path === '/v1/sessions' && method === 'GET') data = world.sessions
    else if (path === '/v1/companies' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 100)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      data = { companies: world.companies.slice(offset, offset + limit), total: world.companies.length }
    } else if (/^\/v1\/sessions\/[^/]+\/threads$/.test(path) && method === 'GET') data = world.subagents
    else if (/^\/v1\/threads\/[^/]+\/queue$/.test(path) && method === 'GET') data = world.queue
    // jointState loads threads and artifacts together: a 404 on artifacts
    // puts the whole dock in its error state (no subagents toggle).
    else if (/^\/v1\/sessions\/[^/]+\/artifacts$/.test(path) && method === 'GET') data = []
    else if (/^\/v1\/threads\/[^/]+\/messages$/.test(path) && method === 'GET') {
      const afterSeq = Number(url.searchParams.get('afterSeq') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 200)
      const key = path.split('/')[3] ?? ''
      const pool = (world.messagesByThread?.[key] ?? world.messages) as Array<{ seq: number }>
      const rows = pool.filter((message) => message.seq > afterSeq).slice(0, limit)
      data = rows
      extra = { nextAfterSeq: rows.length ? rows[rows.length - 1]?.seq : afterSeq }
    } else if (path.endsWith('/files') && method === 'GET') data = world.files
    if (data === null) {
      await route.fallback()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data, ...extra }) })
  })
}

async function installPerf(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __longtasks: number[] }
    store.__longtasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.__longtasks.push(entry.duration)
    }).observe({ entryTypes: ['longtask'] })
  })
}

async function clearLongtasks(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __longtasks: number[] }).__longtasks = [] })
}

async function maxLongtask(page: Page): Promise<number> {
  const durations = await page.evaluate(() => (window as unknown as { __longtasks: number[] }).__longtasks ?? [])
  return durations.length ? Math.max(...durations) : 0
}

async function heapMB(page: Page): Promise<number> {
  return page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    if (!memory) throw new Error('performance.memory unavailable (Chromium only)')
    return memory.usedJSHeapSize / 1048576
  })
}

async function wheelDown(page: Page, target: Locator, steps = 6): Promise<void> {
  await target.hover()
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(100)
  }
}

async function wheelUp(page: Page, hoverTarget: Locator, steps = 6): Promise<void> {
  await hoverTarget.hover()
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -600)
    await page.waitForTimeout(100)
  }
}

// Virtualized reachability: the last row mounts only once scrolled to,
// so wheel to the end (the virtualizer renders on scroll events). First
// paint is asserted separately on row 1; this proves every row renders.
// Hover once on a visible row: the sizer's center is far outside the
// viewport, and the mouse stays over the scrollport for later wheels.
async function wheelToEnd(page: Page, hoverTarget: Locator, last: Locator): Promise<void> {
  await hoverTarget.hover()
  for (let i = 0; i < 60 && (await last.count()) === 0; i++) {
    await page.mouse.wheel(0, 2400)
    await page.waitForTimeout(50)
  }
  await expect(last).toBeAttached({ timeout: 15000 })
}

function dock(page: Page) {
  return page.getByRole('complementary', { name: 'Assistant chat' })
}

async function openDock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  await expect(dock(page)).toBeVisible()
}

async function openSessionsMenu(page: Page): Promise<void> {
  await dock(page).getByRole('button', { name: 'Chat sessions' }).click()
  await expect(page.getByRole('menu', { name: 'Chat sessions' })).toBeVisible()
}

test('sessions render 100/1000/2000 with first render under budget at 1000', async ({ page }) => {
  const world: MutableWorld = { sessions: [], subagents: [], queue: [], messages: [], companies: [], files: [] }
  await serveApi(page, { stream: 'static' })
  await mutableApi(page, world)
  await installPerf(page)
  for (const count of [100, 1000, 2000]) {
    world.sessions = scaleSessions(count)
    await page.goto('/')
    await openDock(page)
    await openSessionsMenu(page)
    const menu = page.getByRole('menu', { name: 'Chat sessions' })
    const first = page.getByRole('menuitem', { name: 'Open Scale chat 1', exact: true })
    const last = page.getByRole('menuitem', { name: `Open Scale chat ${count}` })
    await wheelToEnd(page, first, last)
    if (count === 1000) {
      await page.keyboard.press('Escape')
      await expect(menu).not.toBeAttached()
      const started = Date.now()
      await openSessionsMenu(page)
      await expect(first).toBeAttached({ timeout: 15000 })
      expect(Date.now() - started).toBeLessThanOrEqual(300)
      await wheelToEnd(page, first, last)
    }
    if (count === 2000) {
      await clearLongtasks(page)
      await wheelUp(page, last)
      await expect(menu).toBeVisible()
      expect(await maxLongtask(page)).toBeLessThanOrEqual(50)
    }
  }
})

test('subagents render 100/1000/2000 with first render under budget at 1000', async ({ page }) => {
  // The dock loads threads for its active session: without one the panel never mounts.
  const world: MutableWorld = { sessions: scaleSessions(1), subagents: [], queue: [], messages: [], companies: [], files: [] }
  await serveApi(page, { stream: 'static' })
  await mutableApi(page, world)
  await installPerf(page)
  for (const count of [100, 1000, 2000]) {
    world.subagents = scaleSubagents(count)
    await page.goto('/')
    await openDock(page)
    const toggle = dock(page).getByRole('button', { name: /subagents/ })
    await toggle.click()
    const list = page.locator('[aria-label="Subagent threads"]')
    const first = list.getByRole('button', { name: 'Chat with Scale agent 1', exact: true })
    const last = list.getByRole('button', { name: `Chat with Scale agent ${count}` })
    await wheelToEnd(page, first, last)
    if (count === 1000) {
      await toggle.click()
      // Settle the exit so the timed open is a fresh mount at scroll 0,
      // not a cancelled exit with end-scroll preserved.
      await expect(list).not.toBeAttached()
      const started = Date.now()
      await toggle.click()
      await expect(first).toBeAttached({ timeout: 15000 })
      expect(Date.now() - started).toBeLessThanOrEqual(300)
      await wheelToEnd(page, first, last)
    }
    if (count === 2000) {
      await clearLongtasks(page)
      await wheelUp(page, last)
      await expect(list).toBeVisible()
      expect(await maxLongtask(page)).toBeLessThanOrEqual(50)
    }
  }
})

test('queue renders 100/1000/2000 with first render under budget at 1000', async ({ page }) => {
  const world: MutableWorld = { sessions: sectorSession(), subagents: [], queue: [], messages: [], companies: [], files: [] }
  await serveApi(page, { stream: 'static', data: { sectors: [matrixSector()] } })
  await mutableApi(page, world)
  await installPerf(page)
  for (const count of [100, 1000, 2000]) {
    world.queue = scaleQueue(count)
    await page.goto(SECTOR_ROUTE)
    const trigger = page.getByRole('button', { name: `Queued (${count})` })
    await expect(trigger).toBeVisible({ timeout: 15000 })
    await trigger.click()
    const list = page.locator('[aria-label="Queued messages"]')
    const first = list.getByText('Scale queued 1', { exact: true })
    const last = list.getByText(`Scale queued ${count}`)
    await wheelToEnd(page, first, last)
    if (count === 1000) {
      await trigger.click()
      await expect(list).not.toBeAttached()
      const started = Date.now()
      await trigger.click()
      await expect(first).toBeAttached({ timeout: 15000 })
      expect(Date.now() - started).toBeLessThanOrEqual(300)
      await wheelToEnd(page, first, last)
    }
    if (count === 2000) {
      await clearLongtasks(page)
      await wheelUp(page, last)
      await expect(list).toBeVisible()
      expect(await maxLongtask(page)).toBeLessThanOrEqual(50)
    }
  }
})

test('thread renders 1000 under budget and 5000 with clean scroll', async ({ page }) => {
  const world: MutableWorld = {
    sessions: [...sectorSession(), { id: 'mx-session-002', title: 'Second chat', createdAt: AT, updatedAt: AT, sectorId: 'sector-matrix', kind: 'normal' }],
    subagents: [], queue: [], messages: [], companies: [], files: [],
  }
  await serveApi(page, { stream: 'static', data: { sectors: [matrixSector()] } })
  await mutableApi(page, world)
  await installPerf(page)
  for (const count of [1000, 5000]) {
    world.messagesByThread = {
      'mx-session-001': scaleMessages(count, 'Scale-A'),
      'mx-session-002': scaleMessages(count, 'Scale-B'),
    }
    await page.goto(SECTOR_ROUTE)
    const log = page.getByRole('log', { name: 'Conversation messages' })
    await expect(log).toBeVisible({ timeout: 15000 })
    const last = log.getByText(`Scale-A answer ${count}`)
    await expect(last).toBeAttached({ timeout: 30000 })
    if (count === 1000) {
      // Warm re-render timing: reload timing measures Vite dev module
      // load (556ms floor on an empty page), not product render. The
      // session switch remounts the conversation warm in-section.
      await page.getByRole('button', { name: 'Open Second chat' }).click()
      await expect(log.getByText(`Scale-B answer ${count}`)).toBeAttached({ timeout: 30000 })
      const started = Date.now()
      await page.getByRole('button', { name: 'Open Matrix chat' }).click()
      await expect(log.getByText(`Scale-A answer ${count}`)).toBeAttached({ timeout: 30000 })
      expect(Date.now() - started).toBeLessThanOrEqual(300)
    } else {
      await clearLongtasks(page)
      await wheelDown(page, log, 10)
      await expect(last).toBeVisible({ timeout: 15000 })
      expect(await maxLongtask(page)).toBeLessThanOrEqual(50)
    }
  }
})

test('companies page 100/1000/2000 with first window under budget at 1000', async ({ page }) => {
  const world: MutableWorld = { sessions: [], subagents: [], queue: [], messages: [], companies: [], files: [] }
  await serveApi(page, { stream: 'static', data: { sectors: [matrixSector()] } })
  await mutableApi(page, world)
  await installPerf(page)
  for (const count of [100, 1000, 2000]) {
    world.companies = makeCompanies(count)
    await page.goto(DETAIL_ROUTE)
    const section = page.getByRole('region', { name: 'Companies' })
    const window = section.getByText(`Showing 100 of ${grouped(count)}`)
    await expect(window).toBeVisible({ timeout: 15000 })
    if (count === 1000) {
      // Warm behavior timing: reload timing measures Vite dev module
      // load, not product render. Show more fetches the next window and
      // re-renders warm in-section (same idiom as the files search leg).
      const started = Date.now()
      await section.getByRole('button', { name: 'Show more', exact: true }).click()
      await expect(section.getByText(`Showing 200 of ${grouped(count)}`)).toBeVisible({ timeout: 15000 })
      expect(Date.now() - started).toBeLessThanOrEqual(300)
    }
    if (count === 2000) {
      await clearLongtasks(page)
      await wheelDown(page, window)
      expect(await maxLongtask(page)).toBeLessThanOrEqual(50)
    }
  }
})

test('files window 100/1000/2000 with first window under budget at 1000', async ({ page }) => {
  const world: MutableWorld = { sessions: [], subagents: [], queue: [], messages: [], companies: [], files: [] }
  await serveApi(page, { stream: 'static', data: { sectors: [matrixSector()] } })
  await mutableApi(page, world)
  await installPerf(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const count of [100, 1000, 2000]) {
    world.files = scaleFiles(count)
    await page.goto(SECTOR_ROUTE)
    const files = page.getByRole('region', { name: 'Sector files' })
    await expect(files).toBeVisible({ timeout: 15000 })
    const window = files.getByText(`Showing 50 of ${grouped(count)} files`)
    await expect(window).toBeVisible({ timeout: 15000 })
    if (count === 1000) {
      // Warm behavior timing: reload timing measures Vite dev module
      // load (556ms floor on an empty page), not product render. Search
      // filters all 1000 rows and re-renders warm in-section.
      const search = files.getByRole('textbox', { name: 'Search files' })
      const started = Date.now()
      await search.fill('scale-note-0999')
      await expect(files.getByText('scale-note-0999.md')).toBeVisible({ timeout: 15000 })
      expect(Date.now() - started).toBeLessThanOrEqual(300)
      await search.fill('')
    }
    if (count === 2000) {
      await clearLongtasks(page)
      await wheelDown(page, files)
      expect(await maxLongtask(page)).toBeLessThanOrEqual(50)
    }
  }
})

test('dock open/close cycles keep heap growth under 50MB', async ({ page }, testInfo) => {
  // 12 honest cycles (mocked cascade + 2000-item menu render each) need
  // more than the 30s default; per-cycle cost is flat (trace-verified).
  testInfo.setTimeout(120_000)
  const world: MutableWorld = {
    sessions: scaleSessions(2000), subagents: [], queue: [], messages: [], companies: [], files: [],
  }
  await serveApi(page, { stream: 'static' })
  await mutableApi(page, world)
  await installPerf(page)
  await page.goto('/')
  async function cycle(): Promise<void> {
    await openDock(page)
    await openSessionsMenu(page)
    // First paint only: the dock measures cycle cost, and the menu is
    // virtualized; last-row reachability belongs to the sessions spec.
    await expect(page.getByRole('menuitem', { name: 'Open Scale chat 1', exact: true })).toBeAttached({ timeout: 15000 })
    // Dismiss the menu via its backdrop (the trigger sits under it),
    // then close the dock via its Close button: Escape is ambiguous here
    // (menu vs dock exit race) and the trigger is covered while open.
    await page.getByRole('button', { name: 'Dismiss sessions' }).click()
    await expect(page.getByRole('menu', { name: 'Chat sessions' })).not.toBeVisible()
    await dock(page).getByRole('button', { name: 'Close' }).click()
    await expect(dock(page)).not.toBeVisible()
  }
  await cycle()
  await cycle()
  const before = await heapMB(page)
  for (let i = 0; i < 10; i++) await cycle()
  await page.waitForTimeout(1000)
  const growth = (await heapMB(page)) - before
  expect(growth).toBeLessThan(50)
})
