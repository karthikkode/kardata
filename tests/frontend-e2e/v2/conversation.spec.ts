// Stage 4 conversation (CV-01..11, CP-01..06): the shared chat surfaces in
// the sector workspace, plus the Karbot-only composer states (mentions,
// skills, plan mode, Karbot empty). State shots replay prepare + interact
// for every theme x width combo inside capture().
import { expect, test, type Page } from '@playwright/test'
import { pushFrame, serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'
import type { FixtureMessage } from '../support/fixtures'

const SECTOR = 'sector-electrical'
const THREAD = `session-${SECTOR}-research`

async function gotoWorkspace(page: Page, api: ApiOptions = {}): Promise<void> {
  await serveApi(page, api)
  await page.goto(`/?section=SectorChat&sector=${SECTOR}`)
  await expect(convo(page)).toBeVisible()
}

async function gotoDock(page: Page, api: ApiOptions = {}): Promise<void> {
  await serveApi(page, api)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  await expect(dock(page)).toBeVisible()
}

function convo(page: Page) {
  return page.getByRole('log', { name: 'Conversation messages' })
}

function dock(page: Page) {
  return page.getByRole('complementary', { name: 'Assistant chat' })
}

function composer(page: Page) {
  return page.getByRole('textbox', { name: 'Message this conversation' })
}

function dockComposer(page: Page) {
  return dock(page).getByRole('textbox', { name: 'Message the agent' })
}

/** At <768px the session rail lives in a drawer; open it there, no-op above. */
async function openSessionsDrawerIfNeeded(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Open sessions' })
  if (await trigger.isVisible()) await trigger.click()
  await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
}

async function sendWorkspace(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
}

const LONG_USER_TEXT =
  'Please compare every licensed commercial crew across Parramatta, Ryde and the Sydney metro basin, ' +
  'then rank them by named electrician headcount, after-hours coverage and review recency for the shortlist.'

const LONG_THREAD: FixtureMessage[] = [
  { seq: 1, kind: 'text', role: 'user', text: LONG_USER_TEXT, at: '2026-10-01T10:00:00.000Z' },
  { seq: 2, kind: 'text', role: 'agent', text: 'Ranking the crews now. I will post the table when the coverage pages finish loading.', at: '2026-10-01T10:01:00.000Z' },
]

const MENTION_THREAD: FixtureMessage[] = [
  { seq: 1, kind: 'text', role: 'user', text: 'Is @shortlist.md still current? And @no-such-file.md should stay plain.', at: '2026-10-01T10:00:00.000Z' },
  { seq: 2, kind: 'text', role: 'agent', text: 'The shortlist is current as of this morning.', at: '2026-10-01T10:01:00.000Z' },
]

test('CV-01-long-thread', async ({ page }) => {
  await capture(page, 'CV-01', 'long-thread', () => gotoWorkspace(page), async () => {
    await expect(convo(page).getByText('Noted. I will fold the Ryde crews into the next pass.').first()).toBeVisible()
  })
})

test('CV-02-default', async ({ page }) => {
  await capture(page, 'CV-02', 'default', () => gotoWorkspace(page), async () => {
    await expect(convo(page).getByText('Hold on, check the Ryde crews too before you finish.')).toBeVisible()
  })
})

test('CV-02-long', async ({ page }) => {
  await capture(
    page, 'CV-02', 'long',
    () => gotoWorkspace(page, { data: { messages: LONG_THREAD } }),
    async () => {
      await expect(convo(page).getByText(LONG_USER_TEXT)).toBeVisible()
    },
  )
})

test('CV-02-mentions', async ({ page }) => {
  await capture(
    page, 'CV-02', 'mentions',
    () => gotoDock(page, { data: { messages: MENTION_THREAD } }),
    async () => {
      const bubble = dock(page).getByText('Is @shortlist.md still current?', { exact: false })
      await expect(bubble).toBeVisible()
      // Known files chip; unknown @-words stay plain text.
      await expect(dock(page).getByText('@shortlist.md')).toBeVisible()
      await expect(dock(page).getByText('@no-such-file.md')).toBeVisible()
    },
  )
})

test('CV-03-prose', async ({ page }) => {
  await capture(page, 'CV-03', 'prose', () => gotoWorkspace(page), async () => {
    const prose = convo(page).getByText('I compared the two Parramatta crews on size, coverage and recent reviews.')
    await prose.scrollIntoViewIfNeeded()
    await expect(prose).toBeVisible()
  })
})

test('CV-03-table', async ({ page }) => {
  await capture(page, 'CV-03', 'table', () => gotoWorkspace(page), async () => {
    const table = convo(page).locator('[data-markdown] table').first()
    await table.scrollIntoViewIfNeeded()
    await expect(table.getByText('Bright Spark Electrical Pty Ltd')).toBeVisible()
  })
})

test('CV-03-code', async ({ page }) => {
  await capture(page, 'CV-03', 'code', () => gotoWorkspace(page), async () => {
    const code = convo(page).getByText('site:parramatta commercial electrician licensed crew')
    await code.scrollIntoViewIfNeeded()
    await expect(code).toBeVisible()
  })
})

test('CV-03-lists', async ({ page }) => {
  await capture(page, 'CV-03', 'lists', () => gotoWorkspace(page), async () => {
    const item = convo(page).getByText('Bright Spark Electrical added two apprentice crews in Parramatta.')
    await item.scrollIntoViewIfNeeded()
    await expect(item).toBeVisible()
  })
})

test('CV-04-hover', async ({ page }) => {
  await capture(page, 'CV-04', 'hover', () => gotoWorkspace(page), async () => {
    const last = convo(page).getByText('Noted. I will fold the Ryde crews into the next pass.').last()
    await last.hover()
    await expect(convo(page).getByRole('button', { name: 'Copy' }).last()).toBeVisible()
  })
})

test('CV-05-thinking', async ({ page }) => {
  await capture(
    page, 'CV-05', 'thinking',
    () => gotoWorkspace(page, { stream: 'quiet', data: { messages: [] } }),
    async () => {
      await sendWorkspace(page, 'Thinking probe')
      // The echoed user message lands first: the request is accepted but
      // no live content exists yet, so the bare thinking row shows.
      await pushFrame(page, {
        seq: 41, threadKey: THREAD, type: 'message', at: '',
        payload: { seq: 41, kind: 'text', role: 'user', text: 'Thinking probe' },
      })
      await expect(convo(page).getByText('Thinking', { exact: true })).toBeVisible()
    },
  )
})

test('CV-05-thinking-expanded', async ({ page }) => {
  await capture(
    page, 'CV-05', 'thinking-expanded',
    () => gotoWorkspace(page, { stream: 'quiet', data: { messages: [] } }),
    async () => {
      await sendWorkspace(page, 'Thinking probe')
      await pushFrame(page, {
        seq: 41, threadKey: THREAD, type: 'message', at: '',
        payload: { seq: 41, kind: 'text', role: 'user', text: 'Thinking probe' },
      })
      await pushFrame(page, {
        seq: 42, threadKey: THREAD, type: 'reasoning', at: '',
        payload: { runKey: 'run-1', text: 'Checking the shortlist and crew rosters before answering.' },
      })
      await convo(page).getByRole('button', { name: 'Show live reasoning' }).click()
      await expect(convo(page).getByText('Checking the shortlist and crew rosters before answering.')).toBeVisible()
    },
  )
})

test('CV-06-collapsed', async ({ page }) => {
  await capture(page, 'CV-06', 'collapsed', () => gotoWorkspace(page), async () => {
    const toggle = convo(page).getByRole('button', { name: 'Show reasoning' }).first()
    await toggle.scrollIntoViewIfNeeded()
    await expect(toggle).toBeVisible()
  })
})

test('CV-06-expanded', async ({ page }) => {
  await capture(page, 'CV-06', 'expanded', () => gotoWorkspace(page), async () => {
    const toggle = convo(page).getByRole('button', { name: 'Show reasoning' }).first()
    await toggle.scrollIntoViewIfNeeded()
    await toggle.click()
    await expect(convo(page).getByText('Checked the sector list and compared the two Parramatta crews.')).toBeVisible()
  })
})

test('CV-06-long-reasoning', async ({ page }) => {
  await capture(page, 'CV-06', 'long-reasoning', () => gotoWorkspace(page), async () => {
    const toggle = convo(page).getByRole('button', { name: 'Show reasoning' }).nth(1)
    await toggle.scrollIntoViewIfNeeded()
    await toggle.click()
    await expect(convo(page).getByText('First I checked the sector context for the Parramatta scope notes, then I searched', { exact: false })).toBeVisible()
  })
})

test('CV-07-collapsed', async ({ page }) => {
  await capture(page, 'CV-07', 'collapsed', () => gotoWorkspace(page), async () => {
    const toggle = convo(page).getByRole('button', { name: 'Show tool activity' }).first()
    await toggle.scrollIntoViewIfNeeded()
    await expect(toggle).toBeVisible()
    await expect(convo(page).getByText('Used 3 tools').first()).toBeVisible()
  })
})

test('CV-07-expanded', async ({ page }) => {
  await capture(page, 'CV-07', 'expanded', () => gotoWorkspace(page), async () => {
    const toggle = convo(page).getByRole('button', { name: 'Show tool activity' }).first()
    await toggle.scrollIntoViewIfNeeded()
    await toggle.click()
    await expect(convo(page).getByText('Searched knowledge base')).toBeVisible()
  })
})

test('CV-07-running', async ({ page }) => {
  await capture(
    page, 'CV-07', 'running',
    () => gotoWorkspace(page, { stream: 'quiet', data: { messages: [] } }),
    async () => {
      await sendWorkspace(page, 'Search probe')
      await pushFrame(page, {
        seq: 41, threadKey: THREAD, type: 'tool', at: '',
        payload: { runKey: 'run-1', id: 'tool-1', name: 'web_search', state: 'running' },
      })
      await expect(convo(page).getByText('Using Searched the web...')).toBeVisible()
    },
  )
})

test('CV-07-failed', async ({ page }) => {
  await capture(page, 'CV-07', 'failed', () => gotoWorkspace(page), async () => {
    const toggle = convo(page).getByRole('button', { name: 'Show tool activity' }).nth(1)
    await toggle.scrollIntoViewIfNeeded()
    await toggle.click()
    await expect(convo(page).getByText('Failed').first()).toBeVisible()
  })
})

test('CV-08-queued', async ({ page }) => {
  await capture(
    page, 'CV-08', 'queued',
    () => gotoWorkspace(page, { modes: { commands: 'loading' }, loadingMs: 10000 }),
    async () => {
      await sendWorkspace(page, 'Queued probe')
      await expect(convo(page).getByText('Queued, waiting for the agent')).toBeVisible()
    },
  )
})

test('CV-08-reconnecting', async ({ page }) => {
  await capture(
    page, 'CV-08', 'reconnecting',
    () => gotoWorkspace(page, { stream: 'static' }),
    async () => {
      await expect(convo(page).getByText('Reconnecting. Your conversation is saved.')).toBeVisible()
      await expect(convo(page).getByRole('button', { name: 'Reconnect now' })).toBeVisible()
    },
  )
})

test('CV-08-paused', async ({ page }) => {
  await capture(
    page, 'CV-08', 'paused',
    () => gotoWorkspace(page, { stream: 'quiet', data: { messages: [] } }),
    async () => {
      // History first: the stream attaches right after it resolves, so a
      // frame pushed before this wait can miss every controller.
      await expect(convo(page).getByText('Ask about this research')).toBeVisible()
      await pushFrame(page, {
        seq: 1, threadKey: THREAD, type: 'state', at: '',
        payload: { status: 'PAUSED' },
      })
      await expect(convo(page).getByText('This conversation is paused.')).toBeVisible()
      await expect(convo(page).getByRole('button', { name: 'Resume' })).toBeVisible()
    },
  )
})

test('CV-08-failed', async ({ page }) => {
  await capture(
    page, 'CV-08', 'failed',
    () => gotoWorkspace(page, { modes: { commands: 'error' } }),
    async () => {
      await sendWorkspace(page, 'Doomed question')
      await expect(convo(page).getByText('That reply did not go through.')).toBeVisible()
      // The draft is restored for editing; Retry reuses the same send.
      await expect(composer(page)).toHaveValue('Doomed question')
    },
  )
})

test('CV-09-research', async ({ page }) => {
  await capture(
    page, 'CV-09', 'research',
    // Quiet stream: live priming would fill the history the empty mode
    // just emptied.
    () => gotoWorkspace(page, { stream: 'quiet', modes: { messages: 'empty' } }),
    async () => {
      await expect(convo(page).getByText('Ask about this research')).toBeVisible()
      await expect(convo(page).getByRole('button', { name: 'Summarize progress so far' })).toBeVisible()
    },
  )
})

test('CV-09-chat', async ({ page }) => {
  await capture(
    page, 'CV-09', 'chat',
    () => gotoWorkspace(page, { stream: 'quiet', modes: { messages: 'empty' } }),
    async () => {
      await openSessionsDrawerIfNeeded(page)
      await page.getByRole('tab', { name: /^Chats/ }).click()
      const chats = page.getByRole('list', { name: 'Chat sessions' })
      await expect(chats).toBeVisible()
      await chats.getByRole('button').first().click()
      await expect(convo(page).getByText('Start a conversation')).toBeVisible()
    },
  )
})

test('CV-09-karbot', async ({ page }) => {
  await capture(
    page, 'CV-09', 'karbot',
    () => gotoDock(page, { stream: 'quiet', modes: { messages: 'empty' } }),
    async () => {
      await expect(dock(page).getByText('Ask Karbot anything')).toBeVisible()
      await expect(dock(page).getByRole('button', { name: 'What is running right now?' })).toBeVisible()
    },
  )
})

test('CV-10-visible', async ({ page }) => {
  await capture(page, 'CV-10', 'visible', () => gotoWorkspace(page), async () => {
    // Wait for the full thread first: scrolling a still-loading log pins
    // back to the bottom when the history lands.
    await expect(convo(page).getByText('Noted. I will fold the Ryde crews into the next pass.').last()).toBeVisible()
    await convo(page).evaluate((log) => { log.scrollTop = 0 })
    await expect(page.getByRole('button', { name: 'Latest' })).toBeVisible()
  })
})

test('CV-11-default', async ({ page }) => {
  await capture(
    page, 'CV-11', 'default',
    () => gotoWorkspace(page, { stream: 'quiet', data: { messages: [] } }),
    async () => {
      await sendWorkspace(page, 'First question')
      await expect(page.getByRole('button', { name: 'Steer' })).toBeVisible()
      await composer(page).fill('Change direction')
      const [response] = await Promise.all([
        page.waitForResponse((entry) => entry.url().includes('/v1/commands/steer') && entry.request().method() === 'POST'),
        page.getByRole('button', { name: 'Steer' }).click(),
      ])
      const body = (await response.json()) as { data?: { commandId?: string } }
      const commandId = body.data?.commandId
      expect(commandId).toBeTruthy()
      await pushFrame(page, {
        seq: 41, threadKey: THREAD, type: 'steering-consumption', at: '',
        payload: { ids: [commandId], state: 'missed' },
      })
      await expect(page.getByText('Steering saved for your next turn')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send now' })).toBeVisible()
    },
  )
})

test('CP-01-empty', async ({ page }) => {
  await capture(page, 'CP-01', 'empty', () => gotoWorkspace(page), async () => {
    await expect(composer(page)).toBeVisible()
    await expect(composer(page)).toHaveAttribute('placeholder', 'Ask about this research...')
  })
})

test('CP-01-focus', async ({ page }) => {
  await capture(
    page, 'CP-01', 'focus',
    () => gotoWorkspace(page),
    async () => {
      await composer(page).click()
      await expect(composer(page)).toBeFocused()
    },
    { widths: [1440] },
  )
})

test('CP-01-multiline', async ({ page }) => {
  await capture(page, 'CP-01', 'multiline', () => gotoWorkspace(page), async () => {
    await composer(page).fill('Line one\nLine two\nLine three\nLine four\nLine five')
    const height = await composer(page).evaluate((box) => box.getBoundingClientRect().height)
    expect(height).toBeGreaterThan(60)
  })
})

test('CP-01-disabled', async ({ page }) => {
  await capture(
    page, 'CP-01', 'disabled',
    () => gotoWorkspace(page, { modes: { messages: 'denied' } }),
    async () => {
      await expect(composer(page)).toBeDisabled()
    },
  )
})

test('CP-02-idle', async ({ page }) => {
  await capture(page, 'CP-02', 'idle', () => gotoWorkspace(page), async () => {
    const send = page.getByRole('button', { name: 'Send message' })
    await expect(send).toBeDisabled()
    await composer(page).fill('A draft worth sending')
    await expect(send).toBeEnabled()
  })
})

test('CP-02-busy-empty', async ({ page }) => {
  await capture(
    page, 'CP-02', 'busy-empty',
    () => gotoWorkspace(page, { modes: { commands: 'loading' }, loadingMs: 10000 }),
    async () => {
      await sendWorkspace(page, 'Busy probe')
      await expect(page.getByRole('button', { name: 'Steer' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Queue' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()
    },
  )
})

test('CP-02-busy-draft', async ({ page }) => {
  await capture(
    page, 'CP-02', 'busy-draft',
    () => gotoWorkspace(page, { modes: { commands: 'loading' }, loadingMs: 10000 }),
    async () => {
      await sendWorkspace(page, 'Busy probe')
      await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()
      await composer(page).fill('Steer this way instead')
      await expect(page.getByRole('button', { name: 'Steer' })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'Queue' })).toBeEnabled()
      // The busy toolbar never overlaps itself: the model trigger's box
      // stays disjoint from the Steer box (390px wraps it to its own row).
      const trigger = page.getByRole('button', { name: 'Choose a model' })
      const steer = page.getByRole('button', { name: 'Steer' })
      const overlap = await trigger.evaluate((node, peer) => {
        const a = node.getBoundingClientRect()
        const b = peer.getBoundingClientRect()
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        return x > 1 && y > 1
      }, await steer.elementHandle())
      expect(overlap).toBe(false)
    },
  )
})

test('CP-02-plan-on', async ({ page }) => {
  await capture(page, 'CP-02', 'plan-on', () => gotoDock(page), async () => {
    const plan = dock(page).getByRole('button', { name: 'Toggle plan mode' })
    await plan.click()
    await expect(plan).toHaveAttribute('aria-pressed', 'true')
  })
})

test('CP-03-trigger', async ({ page }) => {
  await capture(page, 'CP-03', 'trigger', () => gotoWorkspace(page), async () => {
    // Bind a model first: the target chip shows name + effort.
    await page.getByRole('button', { name: 'Choose a model' }).click()
    await page.getByRole('menuitemradio', { name: 'Muse Spark 1.3 Compact' }).click()
    await expect(page.getByRole('button', { name: 'Choose a model' }).getByText('Muse Spark 1.3 Compact')).toBeVisible()
  })
})

test('CP-03-menu-open', async ({ page }) => {
  await capture(page, 'CP-03', 'menu-open', () => gotoWorkspace(page), async () => {
    await page.getByRole('button', { name: 'Choose a model' }).click()
    await expect(page.getByRole('textbox', { name: 'Search models' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Muse Spark 1.3 Thinking', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Muse Spark 1.3 Compact' })).toBeVisible()
  })
})

test('CP-03-menu-bottom-docked', async ({ page }) => {
  await capture(page, 'CP-03', 'menu-bottom-docked', () => gotoWorkspace(page), async () => {
    const trigger = page.getByRole('button', { name: 'Choose a model' })
    await trigger.click()
    const menu = page.getByRole('menu').first()
    await expect(menu).toBeVisible()
    // Collision-aware: near the bottom the menu opens above the trigger.
    const placement = await menu.evaluate((node) => {
      const popup = node.getBoundingClientRect()
      const anchor = document.querySelector('[aria-label="Choose a model"]')?.getBoundingClientRect()
      return { popupBottom: popup.bottom, anchorTop: anchor?.top ?? 0 }
    })
    expect(placement.popupBottom).toBeLessThanOrEqual(placement.anchorTop + 8)
  })
})

test('CP-03-search-empty', async ({ page }) => {
  await capture(page, 'CP-03', 'search-empty', () => gotoWorkspace(page), async () => {
    await page.getByRole('button', { name: 'Choose a model' }).click()
    await page.getByRole('textbox', { name: 'Search models' }).fill('zzz-no-such-model')
    await expect(page.getByText('No models match this search.')).toBeVisible()
  })
})

test('CP-03-effort-submenu', async ({ page }) => {
  await capture(page, 'CP-03', 'effort-submenu', () => gotoWorkspace(page), async () => {
    await page.getByRole('button', { name: 'Choose a model' }).click()
    await page.getByRole('menuitem', { name: 'Muse Spark 1.3 Thinking', exact: true }).hover()
    await expect(page.getByRole('menuitemradio', { name: 'high', exact: true })).toBeVisible()
  })
})

test('CP-04-hint', async ({ page }) => {
  await capture(
    page, 'CP-04', 'hint',
    () => gotoWorkspace(page),
    async () => {
      await composer(page).click()
      await expect(page.getByText('to send,')).toBeVisible()
      await expect(page.getByText('for a new line')).toBeVisible()
    },
    { widths: [1440] },
  )
})

test('CP-05-mentions', async ({ page }) => {
  await capture(page, 'CP-05', 'mentions', () => gotoDock(page), async () => {
    await dockComposer(page).fill('Compare @')
    await expect(dock(page).getByRole('listbox', { name: 'Mention a thread or file' })).toBeVisible()
    await expect(dock(page).getByRole('option', { name: /shortlist\.md/ })).toBeVisible()
  })
})

test('CP-05-skills', async ({ page }) => {
  await capture(page, 'CP-05', 'skills', () => gotoDock(page), async () => {
    await dockComposer(page).fill('/r')
    await expect(dock(page).getByRole('listbox', { name: 'Invoke a skill' })).toBeVisible()
    await expect(dock(page).getByRole('option', { name: /research/ })).toBeVisible()
  })
})

test('CP-05-empty', async ({ page }) => {
  await capture(page, 'CP-05', 'empty', () => gotoDock(page), async () => {
    await dockComposer(page).fill('/zzz-no-skill')
    await expect(dock(page).getByText('No skills match "/zzz-no-skill".')).toBeVisible()
  })
})

test('CP-06-failure', async ({ page }) => {
  // Quiet stream: going offline must not trip the reconnecting state and
  // hide the composer notice before the shot.
  await capture(page, 'CP-06', 'failure', () => gotoWorkspace(page, { stream: 'quiet' }), async () => {
    await page.context().setOffline(true)
    try {
      await sendWorkspace(page, 'Offline draft')
      const alert = page.getByRole('alert').filter({ hasText: 'That did not go through.' })
      await expect(alert).toBeVisible()
      await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
    } finally {
      await page.context().setOffline(false)
    }
  })
})
