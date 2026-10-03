// Stage 4 Karbot dock (KB-01..10): container, header, sessions menu,
// context popover (unit-only: no surface sets a scope), chat view,
// composer, session files, states, rename/delete. KB-09-not-connected is
// unit-only (config comes from build-time env, chat-staging pins it).
// State shots replay prepare + interact for every theme x width combo
// inside capture().
import { expect, test, type Page } from '@playwright/test'
import { pushFrame, serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'
import { LONG_NAME, karbotSessions } from '../support/fixtures'

async function gotoDock(page: Page, api: ApiOptions = {}): Promise<void> {
  await serveApi(page, api)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
}

function dock(page: Page) {
  return page.getByRole('complementary', { name: 'Assistant chat' })
}

async function openFiles(page: Page): Promise<void> {
  await dock(page).getByRole('button', { name: 'Session files' }).click()
  await expect(dock(page).getByRole('list', { name: 'Session files' })).toBeVisible()
}

test('KB-01-open', async ({ page }) => {
  await capture(page, 'KB-01', 'open', () => gotoDock(page), async () => {
    await expect(dock(page).getByRole('textbox', { name: 'Message the agent' })).toBeVisible()
  })
})

test('KB-02-default', async ({ page }) => {
  await capture(page, 'KB-02', 'default', () => gotoDock(page), async () => {
    await expect(dock(page).getByRole('button', { name: 'Chat sessions' })).toBeVisible()
    await expect(dock(page).getByRole('button', { name: 'New chat' })).toBeVisible()
    await expect(dock(page).getByRole('button', { name: 'More actions' })).toBeVisible()
  })
})

test('KB-02-long-title', async ({ page }) => {
  const sessions = [{ ...karbotSessions[0]!, title: LONG_NAME }, ...karbotSessions.slice(1)]
  await capture(
    page, 'KB-02', 'long-title',
    () => gotoDock(page, { data: { karbotSessions: sessions } }),
    async () => {
      await expect(dock(page).getByRole('button', { name: 'Chat sessions' })).toBeVisible()
    },
  )
})

test('KB-03-open', async ({ page }) => {
  await capture(page, 'KB-03', 'open', () => gotoDock(page), async () => {
    await dock(page).getByRole('button', { name: 'Chat sessions' }).click()
    await expect(dock(page).getByRole('menu', { name: 'Chat sessions' })).toBeVisible()
  })
})

test('KB-03-many', async ({ page }) => {
  await capture(page, 'KB-03', 'many', () => gotoDock(page), async () => {
    await dock(page).getByRole('button', { name: 'Chat sessions' }).click()
    const menu = dock(page).getByRole('menu', { name: 'Chat sessions' })
    await expect(menu).toBeVisible()
    await menu.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
  })
})

test('KB-05-thread', async ({ page }) => {
  await capture(page, 'KB-05', 'thread', () => gotoDock(page), async () => {
    await expect(dock(page).getByRole('log', { name: 'Chat messages' })).toBeVisible()
  })
})

test('KB-05-thinking', async ({ page }) => {
  await capture(
    page, 'KB-05', 'thinking',
    () => gotoDock(page, { stream: 'quiet', data: { messages: [] } }),
    async () => {
      await pushFrame(page, {
        seq: 1, threadKey: 'session-karbot-01', type: 'reasoning', at: '',
        payload: { runKey: 'run-1', text: 'Checking the shortlist and crew rosters before answering.' },
      })
      await expect(dock(page).getByText('Thinking')).toBeVisible()
    },
  )
})

test('KB-05-tools', async ({ page }) => {
  await capture(page, 'KB-05', 'tools', () => gotoDock(page), async () => {
    await dock(page).getByRole('button', { name: 'Show tool activity' }).first().click()
    await expect(dock(page).getByRole('button', { name: 'Hide tool activity' }).first()).toBeVisible()
    // Wide markdown tables scroll inside their bordered wrapper (CV-03)
    // instead of overflowing the dock.
    const table = dock(page).locator('[data-markdown] table').first()
    await expect(table).toBeVisible()
    const containment = await table.evaluate((el) => {
      const wrapper = el.parentElement
      return {
        innerScroll: (wrapper?.scrollWidth ?? 0) > (wrapper?.clientWidth ?? 0) + 1,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      }
    })
    expect(containment.innerScroll).toBe(true)
    expect(containment.pageOverflow).toBe(false)
  })
})

test('KB-06-default', async ({ page }) => {
  await capture(page, 'KB-06', 'default', () => gotoDock(page), async () => {
    const box = dock(page).getByRole('textbox', { name: 'Message the agent' })
    await expect(box).toBeVisible()
    await box.fill('What is running right now?')
  })
})

test('KB-06-busy', async ({ page }) => {
  await capture(
    page, 'KB-06', 'busy',
    () => gotoDock(page, { modes: { commands: 'loading' }, loadingMs: 10000 }),
    async () => {
      await dock(page).getByRole('textbox', { name: 'Message the agent' }).fill('Busy probe')
      await dock(page).getByRole('button', { name: 'Send message' }).click()
      await expect(dock(page).getByRole('button', { name: 'Steer' })).toBeVisible()
      await expect(dock(page).getByRole('button', { name: 'Queue' })).toBeVisible()
      await expect(dock(page).getByRole('button', { name: 'Stop reply' })).toBeVisible()
      // The busy toolbar never overlaps itself: the model trigger's box
      // stays disjoint from the Steer box (390px wraps it to its own row).
      const trigger = dock(page).getByRole('button', { name: 'Choose a model' })
      const steer = dock(page).getByRole('button', { name: 'Steer' })
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

test('KB-08-list', async ({ page }) => {
  await capture(page, 'KB-08', 'list', () => gotoDock(page), () => openFiles(page))
})

test('KB-08-empty', async ({ page }) => {
  await capture(
    page, 'KB-08', 'empty',
    () => gotoDock(page, { modes: { artifacts: 'empty' } }),
    async () => {
      await dock(page).getByRole('button', { name: 'Session files' }).click()
      await expect(dock(page).getByText('No files yet. Files Karbot or subagents create appear here.')).toBeVisible()
    },
  )
})

test('KB-08-create', async ({ page }) => {
  await capture(page, 'KB-08', 'create', () => gotoDock(page), async () => {
    await openFiles(page)
    await dock(page).getByRole('button', { name: 'New file' }).click()
    await expect(page.getByRole('dialog', { name: 'New file' })).toBeVisible()
  })
})

test('KB-08-preview', async ({ page }) => {
  await capture(page, 'KB-08', 'preview', () => gotoDock(page), async () => {
    await openFiles(page)
    await dock(page).getByRole('button', { name: 'Preview shortlist.md' }).click()
    const dialog = page.getByRole('dialog', { name: 'File preview' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('shortlist.md')).toBeVisible()
  })
})

test('KB-09-denied', async ({ page }) => {
  await capture(
    page, 'KB-09', 'denied',
    () => gotoDock(page, { modes: { sessions: 'denied' } }),
    async () => {
      await expect(dock(page).getByText('Chat is not shared with this key.')).toBeVisible()
    },
  )
})

test('KB-09-loading', async ({ page }) => {
  await capture(
    page, 'KB-09', 'loading',
    () => gotoDock(page, { modes: { sessions: 'loading' }, loadingMs: 15000 }),
    async () => {
      await expect(dock(page).getByRole('status', { name: 'Chat history is loading' })).toBeVisible()
    },
  )
})

test('KB-09-history-error', async ({ page }) => {
  await capture(
    page, 'KB-09', 'history-error',
    () => gotoDock(page, { modes: { sessions: 'error' } }),
    async () => {
      await expect(dock(page).getByText('Chat history did not load.')).toBeVisible()
    },
  )
})

test('KB-09-offline', async ({ page }) => {
  await capture(
    page, 'KB-09', 'offline',
    async () => {
      // Aborted fetch alone maps to error; the offline anatomy needs the
      // browser flag too (see apiErrorStatus). Come back online for the
      // fresh navigation each combo performs, then go offline to refetch.
      await page.context().setOffline(false)
      await gotoDock(page, { modes: { sessions: 'offline' } })
    },
    async () => {
      await expect(dock(page).getByRole('button', { name: 'Try again' })).toBeVisible()
      await page.context().setOffline(true)
      await dock(page).getByRole('button', { name: 'Try again' }).click()
      await expect(dock(page).getByText('No connection')).toBeVisible()
    },
  )
})

test('KB-09-send-failure', async ({ page }) => {
  await capture(
    page, 'KB-09', 'send-failure',
    () => gotoDock(page, { modes: { commands: 'error' } }),
    async () => {
      await dock(page).getByRole('textbox', { name: 'Message the agent' }).fill('Check the sector')
      await dock(page).getByRole('button', { name: 'Send message' }).click()
      await expect(dock(page).getByText('The request failed.')).toBeVisible()
    },
  )
})

test('KB-10-rename', async ({ page }) => {
  await capture(page, 'KB-10', 'rename', () => gotoDock(page), async () => {
    await dock(page).getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await expect(page.getByRole('dialog', { name: 'Rename chat' })).toBeVisible()
  })
})

test('KB-10-delete', async ({ page }) => {
  await capture(page, 'KB-10', 'delete', () => gotoDock(page), async () => {
    await dock(page).getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.getByRole('alertdialog', { name: 'Delete "Browser chat"?' })).toBeVisible()
  })
})
