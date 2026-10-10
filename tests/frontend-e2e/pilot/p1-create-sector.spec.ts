// P1: create the pilot sector from the UI. Proves the landing shows
// it as a draft. Saves the sector name for later steps.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, startRecording } from './record.js'

test.describe('P1 create sector', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('landing shows the new draft', async ({ page }) => {
    const rec = startRecording(page, 'p1')
    const state = loadState()
    const name = state.sectorName ?? `AU electrical, plumbing and HVAC services ${state.tag}`
    await rec.mark('create-draft', async () => {
      await page.goto('/?section=Researches')
      await expect(page.getByRole('heading', { name: 'Researches', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'New sector' }).click()
      const dialog = page.getByRole('dialog', { name: 'New sector' })
      await expect(dialog).toBeVisible()
      const form = dialog.getByRole('form', { name: 'Create a sector' })
      await form.getByLabel('Name').fill(name)
      await form.getByLabel('Topic (optional)').fill('AU trades sector pilot')
      await dialog.getByRole('button', { name: 'Create sector' }).click()
      await expect(page.getByText(name).first()).toBeVisible()
    })
    await rec.shot('draft')
    saveState({ sectorName: name })
    rec.finish()
    expectClean(rec)
  })
})
