import { expect, test } from '@playwright/test'
import { assertNoOverflow } from './support/matrix'

// Overflow-checker contract: visually-hidden and by-design-clipped content is
// not overflow; genuinely overflowing content still fails.
test('sr-only content is not overflow', async ({ page }) => {
  await page.setContent(
    '<span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">screen reader only, far too long for one pixel</span><p>visible</p>',
  )
  await assertNoOverflow(page)
})

test('radix-style 1px clipped span is not overflow', async ({ page }) => {
  await page.setContent(
    '<span role="presentation" style="clip-path:inset(50%);overflow:hidden;white-space:nowrap;border:0;padding:0;width:1px;height:1px;margin:-1px;position:fixed;top:0;left:0">x</span><p>visible</p>',
  )
  await assertNoOverflow(page)
})

test('base-ui hidden input is not overflow', async ({ page }) => {
  await page.setContent(
    '<input value="all" style="position:fixed;width:1px;height:40px;overflow:clip;clip-path:inset(50%)" /><p>visible</p>',
  )
  await assertNoOverflow(page)
})

test('ellipsis-truncated text is not overflow', async ({ page }) => {
  await page.setContent(
    '<div style="width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">unbroken-text-that-must-clip-with-ellipsis</div>',
  )
  await assertNoOverflow(page)
})

test('real overflow still fails', async ({ page }) => {
  await page.setContent(
    '<div style="width:100px;overflow:visible">unbrokenspillpasttheboxandpageunbrokenspillpastthebox</div>',
  )
  await expect(assertNoOverflow(page)).rejects.toThrow('horizontal overflow')
})

test('overlay-only overflow is not overflow', async ({ page }) => {
  await page.setContent(
    '<div style="position:relative;width:100px;overflow:visible"><span>trigger</span><div role="menu" style="position:absolute;left:0;top:100%;width:320px">overlay wider than its anchor by design</div></div>',
  )
  await assertNoOverflow(page)
})

test('in-flow child spill still fails', async ({ page }) => {
  await page.setContent(
    '<div style="width:100px;overflow:visible"><div style="width:300px">in-flow child wider than its container</div></div>',
  )
  await expect(assertNoOverflow(page)).rejects.toThrow('horizontal overflow')
})
