// P7: live research controls. Steers the parent and 3 running
// subagents, pauses/resumes 2, stops 1, reorders + removes a queued
// message, toggles global context off/on. Mid-turn steers prove a DB
// consumed receipt + no error UI (the 'Steering saved' banner is
// missed-steers only). Paused children offer Send, not Steer: sends
// queue visibly (the 409 steer contract is covered at the backend
// tier, api.rest.test.ts).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, openChat, openChats, openWorkspace, startRecording } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

/** Open the selected session's Subagents directory, verified: the
 * live strip re-renders under the click (detached node → silent
 * no-op), so re-click until the dialog shows, then return it. */
async function openDirectory(page: Page): Promise<Locator> {
  const directory = page.getByRole('dialog', { name: 'Subagents' })
  for (let attempt = 0; attempt < 4; attempt++) {
    // Forced: the live tail keeps this strip unstable for minutes.
    await page.getByRole('button', { name: /View all \d+/ }).click({ force: true })
    await page.waitForTimeout(2000)
    if (await directory.isVisible().catch(() => false)) return directory
  }
  await expect(directory).toBeVisible({ timeout: 15000 })
  return directory
}

/** Open a child chat by key, VERIFIED: the Back button proves child
 * context (SectorWorkspace renders it only when model.child is set;
 * a parent shows 'Back to sector summary' instead). Defense against
 * a dialog that closes without switching: r0c slot 0's probes once
 * landed on spawn-b — first read as a wrong-chat open (R0-13), but
 * the child had actually FINISHED and the backend correctly routed
 * the sends to the session as missed_steer (R0-13b). Retries the
 * open when the marker never appears. */
async function openChildByKey(page: Page, threadKey: string, parentTitle: string): Promise<void> {
  const back = page.getByRole('button', { name: 'Back to parent conversation' })
  for (let attempt = 0; attempt < 3; attempt++) {
    const directory = await openDirectory(page)
    await directory.locator('li', { has: page.getByTitle(threadKey) }).getByRole('button', { name: /^Open / }).click()
    await expect(directory).toBeHidden({ timeout: 15000 })
    const start = Date.now()
    for (;;) {
      if ((await back.count()) > 0) return
      if (Date.now() - start > 10000) break
      await page.waitForTimeout(500)
    }
  }
  throw new Error(`pilot p7: could not open child ${threadKey} (dialog closes, chat stays in ${parentTitle})`)
}

/** Wait for a probe turn to start (Steer visible), tolerating
 * supervision flaps: a child paused mid-probe is resumed and the
 * wait continues; a poisoned one throws for the caller to re-pick. */
async function awaitTurnStart(page: Page, threadKey?: string): Promise<void> {
  const steer = page.getByRole('button', { name: 'Steer', exact: true })
  const banner = page.getByText('This conversation is paused.')
  const start = Date.now()
  for (;;) {
    if ((await steer.count()) > 0) return
    if (await banner.isVisible().catch(() => false)) {
      if (threadKey && (await isPoisoned(threadKey))) {
        throw new Error(`pilot p7: cannot pause ${threadKey} (poisoned mid-probe, re-pick)`)
      }
      // Bare Resume: the banner's own button. /^Resume /.first()"
      // would hit the strip's first row (r0c: resumed poisoned beta
      // for 180s while the open child stayed paused).
      await page.getByRole('button', { name: 'Resume', exact: true }).click()
    }
    if (Date.now() - start > 180000) throw new Error(`pilot p7: probe turn never started${threadKey ? ` for ${threadKey}` : ''}`)
    // 500ms, not 3s: short probe turns end in ~5s and a coarse poll
    // wastes most of the landing window before the Steer click.
    await page.waitForTimeout(500)
  }
}

/** Pause one directory row by thread key, verified by its Resume flip.
 * Already-paused returns; finished throws for the caller to re-pick.
 * The flip needs a loop iteration (R0-10), so after clicking Pause
 * the mark wakes idle threads with a probe: mid-turn threads flip
 * at turn end, idle ones iterate on the probe and park. */
async function pauseChildByKey(page: Page, threadKey: string, sectorName: string, parentTitle: string): Promise<void> {
  const scan = await openDirectory(page)
  const scanRow = scan.locator('li', { has: page.getByTitle(threadKey) })
  if ((await scanRow.getByRole('button', { name: /^Resume / }).count()) > 0) {
    await page.keyboard.press('Escape')
    await expect(scan).toBeHidden({ timeout: 15000 })
    return
  }
  const runnable = (await scanRow.getByRole('button', { name: /^Pause / }).count()) > 0
  await page.keyboard.press('Escape')
  await expect(scan).toBeHidden({ timeout: 15000 })
  if (!runnable) throw new Error(`pilot p7: cannot pause ${threadKey} (finished, no controls)`)
  const directory = await openDirectory(page)
  const row = directory.locator('li', { has: page.getByTitle(threadKey) })
  await row
    .getByRole('button', { name: /^Pause / })
    .click({ force: true })
    .catch(() => undefined)
  await page.keyboard.press('Escape')
  await expect(directory).toBeHidden({ timeout: 15000 })
  // Wake the loop when idle: reload FIRST — chat.busy sticks true
  // after a turn ends (stale Steer) and would skip the probe while
  // the idle child never iterates, so the pause never surfaces
  // (R0-10) and the poll below burns 5 min (r0c 654e9e26, R0-12).
  // After a reload Steer is server truth: genuinely mid-turn.
  await page.reload()
  await openWorkspace(page, sectorName)
  await openChats(page)
  await openChat(page, parentTitle, sectorName)
  await openChildByKey(page, threadKey, parentTitle)
  const send = page.getByRole('button', { name: 'Send message' })
  const steer = page.getByRole('button', { name: 'Steer', exact: true })
  await expect(send.or(steer)).toBeVisible({ timeout: 60000 })
  if ((await steer.count()) > 0) {
    // Genuinely mid-turn: wait for the turn to end, then probe —
    // the probe turn parks at its end and the pause surfaces. Past
    // 5 min re-pick (the pause surfaces on its own later and the
    // stop-one scan resumes it via its Resume button).
    try {
      await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 300000 })
    } catch {
      throw new Error(`pilot p7: cannot pause ${threadKey} (turn exceeded 5 min, re-pick)`)
    }
  }
  await page.getByLabel('Message this conversation').fill('Pilot pause wake: acknowledge and standby.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.getByRole('button', { name: 'Back to parent conversation' }).click()
  // Poll only: control is set, the signal sent — re-clicking cannot
  // hurry the in-flight turn. 5 min covers loaded-box turns.
  const start = Date.now()
  for (;;) {
    const check = await openDirectory(page)
    const checkRow = check.locator('li', { has: page.getByTitle(threadKey) })
    const flipped = (await checkRow.getByRole('button', { name: /^Resume / }).count()) > 0
    const gone = (await checkRow.getByRole('button', { name: /^Pause / }).count()) === 0 && !flipped
    await page.keyboard.press('Escape')
    await expect(check).toBeHidden({ timeout: 15000 })
    if (flipped) return
    if (gone) throw new Error(`pilot p7: cannot pause ${threadKey} (finished mid-mark, no controls)`)
    if (Date.now() - start > 300000) throw new Error(`pilot p7: pause never flipped for ${threadKey}`)
    await page.waitForTimeout(10000)
  }
}

/** Pause the first running directory row and return its key, re-picking
 * when a child finishes or pauses between scan and click. */
async function pauseOneRunning(page: Page, sectorName: string, parentTitle: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const scan = await openDirectory(page)
    const rows = scan.getByRole('list', { name: 'Subagents' }).getByRole('button', { name: /^Open / })
    let target: string | null = null
    for (let row = 0; row < (await rows.count()); row++) {
      const key = await rows.nth(row).getAttribute('title')
      const li = scan.locator('li', { has: page.getByTitle(key ?? '###none###') })
      if (key && (await li.getByRole('button', { name: /^Pause / }).count()) > 0) {
        target = key
        break
      }
    }
    await page.keyboard.press('Escape')
    await expect(scan).toBeHidden({ timeout: 15000 })
    if (!target) throw new Error('pilot p7: no running child to pause')
    try {
      await pauseChildByKey(page, target, sectorName, parentTitle)
      return target
    } catch (error) {
      if (attempt === 2 || !(error instanceof Error) || !error.message.includes('cannot pause')) throw error
    }
  }
  throw new Error('pilot p7: no running child to pause')
}

/** True when the thread can never resume: a failed operation.recovery
 * (uncertain poison, R0-2 family) replays the crash on every resume.
 * Directory/strip row buttons carry the thread key as their title. */
async function isPoisoned(threadKey: string): Promise<boolean> {
  const rows = await pilotRoQuery<{ n: string }>(
    `SELECT count(*) AS n FROM thread_messages WHERE thread_key = $1
     AND kind = 'tool' AND payload::text LIKE '%operation.recovery%'
     AND payload::text LIKE '%"state": "failed"%'`,
    [threadKey],
  )
  return Number(rows[0]?.n ?? 0) > 0
}

/** True when the child finished: sends to it land on the session as
 * missed_steer and never turn (threads.status FINISHED). */
async function isFinished(threadKey: string): Promise<boolean> {
  const rows = await pilotRoQuery<{ status: string }>(`SELECT status FROM threads WHERE key = $1`, [threadKey])
  return rows[0]?.status === 'FINISHED'
}

/** Resume one directory row by thread key (skips the strip, whose
 * first rows may be poisoned-paused and unflippable). Re-clicks like
 * the pause path; already-running returns. */
async function resumeChildByKey(page: Page, threadKey: string): Promise<void> {
  const directory = await openDirectory(page)
  const row = directory.locator('li', { has: page.getByTitle(threadKey) })
  const pause = row.getByRole('button', { name: /^Pause / })
  const resume = row.getByRole('button', { name: /^Resume / })
  const start = Date.now()
  for (;;) {
    if ((await pause.count()) > 0) break
    if ((await resume.count()) > 0) {
      await resume.click().catch(() => undefined)
    } else {
      await page.keyboard.press('Escape')
      throw new Error(`pilot p7: cannot resume ${threadKey} (finished, no controls)`)
    }
    await page.waitForTimeout(3000)
    if (Date.now() - start > 120000) {
      await page.keyboard.press('Escape')
      throw new Error(`pilot p7: resume never flipped for ${threadKey}`)
    }
  }
  await page.keyboard.press('Escape')
  await expect(directory).toBeHidden({ timeout: 15000 })
}

test.describe('P7 research controls', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('steer, pause, resume, stop, queue, toggle', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p7')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    const receipts = async (): Promise<number> => {
      const rows = await pilotRoQuery<{ n: string }>(
        `SELECT count(*) AS n FROM thread_instructions WHERE text LIKE 'pilot-p7-%'`,
      )
      return Number(rows[0]?.n ?? 0)
    }
    // Land a steer on a running turn, retrying when the turn ends
    // mid-fill (the composer flips back to Send and Steer vanishes).
    const steerRunning = async (probe: string, text: string): Promise<void> => {
      const box = page.getByLabel('Message this conversation')
      const send = page.getByRole('button', { name: 'Send message' })
      const steer = page.getByRole('button', { name: 'Steer', exact: true })
      // A provider failure auto-pauses the thread (R0-8) and the strip
      // can miss it: resume inside the chat when paused, then steer.
      // Bare Resume (the banner's): strip-first would hit another row.
      if (await page.getByText('This conversation is paused.').isVisible().catch(() => false)) {
        await page.getByRole('button', { name: 'Resume', exact: true }).click()
      }
      let lastState = 'unknown'
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(send.or(steer)).toBeVisible({ timeout: 60000 })
        if ((await steer.count()) === 0) {
          await box.fill(probe)
          await send.click()
          await awaitTurnStart(page)
        }
        await box.fill(text)
        // Forced: the streaming message list above keeps the composer
        // shifting (same instability as the View-all strip).
        const clicked = await steer.click({ timeout: 10000, force: true }).then(
          () => true,
          () => false,
        )
        if (clicked) return
        lastState =
          `send=${await send.count()} steer=${await steer.count()} ` +
          `paused=${await page.getByText('This conversation is paused.').isVisible().catch(() => false)}`
      }
      throw new Error(`pilot p7: could not land steer after 3 attempts: ${text} (last: ${lastState})`)
    }
    // A mid-turn steer is consumed by the live turn (no banner by
    // design): the durable proof is the consumed instruction row. A
    // steer that lands after the last round goes missed and the
    // runner redelivers it as the next user turn (F13): that message
    // is the receipt then. Thread-scoped: slot texts move across
    // threads between attempts, and a dead thread's row must not
    // shadow the new one.
    const awaitConsumed = async (text: string, threadKey?: string): Promise<void> => {
      const start = Date.now()
      for (;;) {
        const rows =
          threadKey === undefined
            ? await pilotRoQuery<{ state: string; thread_key: string; at: string }>(
                `SELECT state, thread_key, at FROM thread_instructions WHERE text = $1 ORDER BY at DESC LIMIT 1`,
                [text],
              )
            : await pilotRoQuery<{ state: string; thread_key: string; at: string }>(
                `SELECT state, thread_key, at FROM thread_instructions WHERE text = $1 AND thread_key = $2 ORDER BY at DESC LIMIT 1`,
                [text, threadKey],
              )
        if (rows[0]?.state === 'consumed') return
        if (rows[0]?.state === 'missed') {
          const redelivered = await pilotRoQuery<{ n: string }>(
            `SELECT count(*) AS n FROM thread_messages WHERE thread_key = $1 AND kind = 'text'
             AND payload->>'role' = 'user' AND payload->>'text' = $2 AND at > $3`,
            [rows[0].thread_key, text, rows[0].at],
          )
          if (Number(redelivered[0]?.n ?? 0) > 0) return
        }
        if (Date.now() - start > 600_000) {
          throw new Error(`pilot p7: steer never consumed: ${text} (state ${rows[0]?.state ?? 'missing'})`)
        }
        await page.waitForTimeout(5000)
      }
    }
    await rec.mark('open-research', async () => {
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
    })
    await rec.mark('steer-parent', async () => {
      // Steer shows only mid-reply (v2 conversation.spec.ts CV-11 sends
      // first): open the research parent, start a turn, then steer it.
      // Fresh UI first: the SPA caches busy/paused per thread and can
      // serve a ghost Steer + ghost banner on an idle unpaused chat
      // (r0c slot 0 burned all attempts with zero backend effect, R0-12).
      await page.reload()
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
      await openChat(page, 'pilot-research', state.sectorName!)
      await steerRunning('Pilot steer probe: keep digging, more depth please.', 'pilot-p7-parent: prioritise regional NSW.')
      await expect(page.getByRole('alert')).toBeHidden({ timeout: 15000 })
      await awaitConsumed('pilot-p7-parent: prioritise regional NSW.')
    })
    await rec.mark('steer-children', async () => {
      // No per-row steer: open each child chat, then steer its composer.
      // Spawn-b holds the button + agent children (pilot-research,
      // the parent above, has none). 'Back to parent conversation'
      // stays in the workspace (r0: 'Back to sector summary' left for
      // SectorDetail, which has no directory).
      await openChat(page, 'pilot-spawn-b', state.sectorName!)
      // Normalize via the directory: resume every paused child that
      // can resume. Poisoned ones (failed recovery → resume replays
      // the crash) stay paused and are skipped as steer targets.
      const scan = await openDirectory(page)
      const scanRows = scan.getByRole('list', { name: 'Subagents' }).getByRole('button', { name: /^Open / })
      const scanCount = await scanRows.count()
      const pausedKeys: string[] = []
      for (let row = 0; row < scanCount; row++) {
        const button = scanRows.nth(row)
        const key = await button.getAttribute('title')
        if (key && (await button.textContent())?.includes('Paused') && !(await isPoisoned(key))) pausedKeys.push(key)
      }
      await page.keyboard.press('Escape')
      await expect(scan).toBeHidden({ timeout: 15000 })
      for (const key of pausedKeys) await resumeChildByKey(page, key)
      // Steer candidates: every live unpoisoned row (r0c row 0 is
      // pilot-beta, poisoned by a failed commit_child_context).
      // Live = Pause control present (running/queued; paused rows
      // show Resume, finished rows show nothing): sends to a FINISHED
      // child land on the session as missed_steer and never turn (r0c
      // 654e9e26 finished 11:05:08; two runs burned slot 0 on it,
      // R0-13b). Spares matter: children finish mid-mark as tracks
      // complete.
      const candidates: string[] = []
      const pick = await openDirectory(page)
      const pickRows = pick.getByRole('list', { name: 'Subagents' }).getByRole('button', { name: /^Open / })
      const pickCount = await pickRows.count()
      for (let row = 0; row < pickCount; row++) {
        const key = await pickRows.nth(row).getAttribute('title')
        if (!key || (await isPoisoned(key))) continue
        const li = pick.locator('li', { has: page.getByTitle(key) })
        if ((await li.getByRole('button', { name: /^Pause / }).count()) === 0) continue
        candidates.push(key)
      }
      await page.keyboard.press('Escape')
      await expect(pick).toBeHidden({ timeout: 15000 })
      if (candidates.length < 3) throw new Error(`pilot p7: only ${candidates.length} steerable children`)
      let slot = 0
      for (const target of candidates) {
        if (slot >= 3) break
        try {
          // Fresh UI per target (R0-12 ghosts) + key-driven open: row
          // indexes shift as children finish/reorder between pick and
          // open, but keys don't.
          await page.reload()
          await openWorkspace(page, state.sectorName!)
          await openChats(page)
          await openChat(page, 'pilot-spawn-b', state.sectorName!)
          await openChildByKey(page, target, 'pilot-spawn-b')
          const text = `pilot-p7-child-${slot}: skip franchises.`
          await steerRunning('Pilot steer probe: keep going, more depth please.', text)
          await expect(page.getByRole('alert')).toBeHidden({ timeout: 15000 })
          await awaitConsumed(text, target)
          await page.getByRole('button', { name: 'Back to parent conversation' }).click()
          slot++
        } catch (error) {
          // Finished between pick and probe: the probe became a
          // session missed_steer, no turn ever starts. Re-pick the
          // next candidate; anything else (or a live child that
          // stalls) still fails loudly. Slot texts are thread-scoped
          // (awaitConsumed keys on thread), so reusing a slot number
          // after a finished re-pick is safe.
          const message = error instanceof Error ? error.message : ''
          if (message.includes('probe turn never started') && (await isFinished(target))) continue
          throw error
        }
      }
      if (slot < 3) throw new Error(`pilot p7: only ${slot} steered children (rest finished mid-mark)`)
    })
    await rec.mark('pause-resume', async () => {
      // Key-driven (never strip-first): poisoned-paused rows stay
      // paused forever and would trap positional flips.
      const first = await pauseOneRunning(page, state.sectorName!, 'pilot-spawn-b')
      const second = await pauseOneRunning(page, state.sectorName!, 'pilot-spawn-b')
      await resumeChildByKey(page, first)
      await resumeChildByKey(page, second)
    })
    await rec.mark('paused-queues', async () => {
      // Pause the first running row by key, then open THAT row: the
      // paused banner proves the identity, loudly on mismatch.
      const target = await pauseOneRunning(page, state.sectorName!, 'pilot-spawn-b')
      await openChildByKey(page, target, 'pilot-spawn-b')
      await expect(page.getByText('This conversation is paused.')).toBeVisible({ timeout: 15000 })
      // No Steer affordance when paused: sends queue instead. Unique
      // text per attempt: targets repeat across reruns, and a stale
      // row from the last attempt would satisfy every poll below.
      const hello = `pilot-p7-paused: hello ${Date.now()}`
      const box = page.getByLabel('Message this conversation')
      const send = page.getByRole('button', { name: 'Send message' })
      // Verify the POST body (text AND thread): a composer racing the
      // child open can 202 the right text to the stale thread (r0c:
      // correct-text body twice, no row anywhere, queue frozen).
      const bodies: unknown[] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        await box.fill(hello)
        await expect(box).toHaveValue(hello, { timeout: 15000 })
        await expect(send).toBeEnabled({ timeout: 15000 })
        const [observed] = await Promise.all([
          page.waitForRequest(
            (entry) => entry.url().includes('/v1/commands/send') && entry.method() === 'POST',
            { timeout: 30000 },
          ),
          send.click(),
        ])
        const body = observed.postDataJSON() as { text?: unknown; threadKey?: unknown } | null
        bodies.push([body?.threadKey ?? null, body?.text ?? null])
        if (body?.text === hello && body?.threadKey === target) break
        if (attempt === 2) throw new Error(`pilot p7: send bodies wrong 3x: ${JSON.stringify(bodies)}`)
        await page.waitForTimeout(3000)
      }
      // Reload: the queue view polls only while busy and sends don't
      // refresh it (R0-11), so navigate out and back to force a load.
      // Then either the button (held pause, still buffered) or the row
      // (a flap-resume shifted it into a turn) proves the send — user
      // rows materialize on inbox SHIFT, not on send.
      await page.getByRole('button', { name: 'Back to parent conversation' }).click()
      await openChildByKey(page, target, 'pilot-spawn-b')
      const settledStart = Date.now()
      for (;;) {
        if ((await page.getByRole('button', { name: /Queued \(\d+\)/ }).count()) > 0) break
        const shifted = await pilotRoQuery<{ n: string }>(
          `SELECT count(*) AS n FROM thread_messages WHERE thread_key = $1 AND kind = 'text'
           AND payload->>'role' = 'user' AND payload->>'text' = $2`,
          [target, hello],
        )
        if (Number(shifted[0]?.n ?? 0) > 0) break
        if (Date.now() - settledStart > 60000) {
          throw new Error(`pilot p7: hello to ${target} neither queued nor shifted (bodies ${JSON.stringify(bodies)})`)
        }
        await page.waitForTimeout(3000)
      }
      await page.getByRole('button', { name: 'Back to parent conversation' }).click()
      await resumeChildByKey(page, target)
    })
    await rec.mark('stop-one', async () => {
      // Key-driven: paused rows show no Stop, and supervision keeps
      // pausing idle children — resume one unpoisoned row first when
      // no Stop is available, then stop that row.
      let target: string | null = null
      for (let attempt = 0; attempt < 3 && !target; attempt++) {
        const scan = await openDirectory(page)
        const rows = scan.getByRole('list', { name: 'Subagents' }).getByRole('button', { name: /^Open / })
        const pausedKeys: string[] = []
        for (let row = 0; row < (await rows.count()); row++) {
          const key = await rows.nth(row).getAttribute('title')
          if (!key || (await isPoisoned(key))) continue
          const li = scan.locator('li', { has: page.getByTitle(key) })
          if ((await li.getByRole('button', { name: /^Stop / }).count()) > 0) {
            target = key
            break
          }
          if ((await li.getByRole('button', { name: /^Resume / }).count()) > 0) pausedKeys.push(key)
        }
        await page.keyboard.press('Escape')
        await expect(scan).toBeHidden({ timeout: 15000 })
        if (!target && pausedKeys.length > 0) await resumeChildByKey(page, pausedKeys[0]!)
      }
      if (!target) throw new Error('pilot p7: no stoppable child (all paused/poisoned/finished)')
      const directory = await openDirectory(page)
      const row = directory.locator('li', { has: page.getByTitle(target) })
      // alertdialog, not dialog: ConfirmAction is a Base UI
      // AlertDialog (r0c probe: dialogsAfterStop=0, alertdialogs=1).
      const confirm = page.getByRole('alertdialog', { name: 'Stop this agent?' })
      // Verified: live re-renders no-op detached clicks silently.
      for (let attempt = 0; ; attempt++) {
        await row.getByRole('button', { name: /^Stop / }).click({ force: true }).catch(() => undefined)
        await page.waitForTimeout(2000)
        if (await confirm.isVisible().catch(() => false)) break
        if (attempt >= 3) throw new Error(`pilot p7: stop confirm never opened for ${target}`)
      }
      // Scoped to the confirm: a live reply also shows Stop agent.
      await confirm.getByRole('button', { name: 'Stop agent' }).click()
      await expect(page.getByText(/stopped/i).first()).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('queue-reorder-remove', async () => {
      // pilot-research, not spawn-b: spawn-b is poisoned-paused since
      // P4 (operation.recovery failed 07:47, R0-13) and can never turn
      // again — the Queue button needs a live reply. The research
      // parent is healthy (steer-parent just turned there).
      await openChat(page, 'pilot-research', state.sectorName!)
      // Queue shows only mid-reply, and the reply can end between the
      // wait and the click: re-probe whenever Queue is gone. Proof is
      // the cleared box: a queued draft clears it, while a click that
      // raced the turn end leaves the text behind (draft survives the
      // busy→idle flip).
      const queueOne = async (text: string): Promise<void> => {
        const queue = page.getByRole('button', { name: 'Queue', exact: true })
        const box = page.getByLabel('Message this conversation')
        for (let attempt = 0; attempt < 3; attempt++) {
          if ((await queue.count()) === 0) {
            await box.fill('Pilot queue probe: narrate slowly, in great detail.')
            await page.getByRole('button', { name: 'Send message' }).click()
            await expect(queue).toBeVisible({ timeout: 120000 })
          }
          await box.fill(text)
          const clicked = await queue.click({ timeout: 10000 }).then(
            () => true,
            () => false,
          )
          if (!clicked) continue
          try {
            await expect(box).toHaveValue('', { timeout: 15000 })
            return
          } catch {
            // Box kept the text: the click raced the turn end.
          }
        }
        throw new Error(`pilot p7: could not queue ${text} after 3 attempts`)
      }
      // Rows reorder via Move up/down and remove via Remove <text> (no drag handle).
      // Unique per attempt: reruns would duplicate fixed texts and
      // strict-violate the row buttons. Baseline-relative count: a
      // failed attempt may have left rows behind.
      const queueButton = page.getByRole('button', { name: /Queued \(\d+\)/ })
      const queueBase = Number((await queueButton.textContent().catch(() => null))?.match(/\d+/)?.[0] ?? 0)
      const stamp = Date.now()
      const queuedA = `pilot-p7-queued-a ${stamp}`
      const queuedB = `pilot-p7-queued-b ${stamp}`
      await queueOne(queuedA)
      await queueOne(queuedB)
      // Expand the disclosure: Move/Remove render inside the
      // CollapsiblePanel, not inline (the inline row is text + status
      // only). The trigger is the Queued (N) button itself.
      await queueButton.click()
      await page.getByRole('button', { name: `Move ${queuedB} up` }).click()
      await page.getByRole('button', { name: `Remove ${queuedA}` }).click()
      await expect(queueButton).toHaveText(new RegExp(`Queued \\(${queueBase + 1}\\)`), { timeout: 60000 })
    })
    await rec.mark('context-toggle', async () => {
      // Menu path: 'Local context' is a menuitem inside the closed
      // Conversation options popup (Base UI Menu.Item), never a
      // button — the bare button click could never resolve.
      await page.getByRole('button', { name: 'Conversation options' }).click()
      await page.getByRole('menuitem', { name: 'Local context' }).click()
      const toggle = page.getByRole('switch', { name: 'Use global context' })
      await expect(toggle).toBeVisible()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 30000 })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30000 })
    })
    await rec.shot('controls')
    await rec.mark('db-receipts', async () => {
      expect(await receipts()).toBeGreaterThanOrEqual(4)
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
