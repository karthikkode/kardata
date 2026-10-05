// v2 automated style audit (plan 9.3). Runs on the current page and
// returns violations plus a per-check pass/fail/skip map. Reports land in
// frontend/test-results/v2/audit/<name>.json.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { contrastRatio, parseCssColor } from './color'
import { V2_AUDIT } from './shot'

export interface AuditViolation {
  check: string
  selector: string
  detail: string
}

export type CheckStatus = 'pass' | 'fail' | 'skip'

export interface AuditResult {
  violations: AuditViolation[]
  checks: Record<string, CheckStatus>
}

export interface AuditOptions {
  skip?: string[]
  sectionSelector?: string
}

interface TextNodeRecord {
  selector: string
  weight: string
  size: number
  color: string
  background: string | null
  text: string
  markdownStrong: boolean
}

const ALLOWED_SIZES = new Set([11, 12, 13, 14, 15, 16, 20, 24, 28])
const RAW_TEXT = /\b(db\.[a-z_]+|direction shards|query shapes|SectorChat|SectorDetail|undefined|null|NaN)\b/

function normalizeWeight(weight: string): number {
  if (weight === 'normal') return 400
  if (weight === 'bold') return 700
  const value = Number(weight)
  return Number.isFinite(value) ? value : 400
}

export async function auditPage(page: Page, options: AuditOptions = {}): Promise<AuditResult> {
  const skipped = new Set(options.skip ?? [])
  const violations: AuditViolation[] = []
  const checks: Record<string, CheckStatus> = {}
  const fail = (check: string, selector: string, detail: string): void => {
    violations.push({ check, selector, detail })
  }

  // -- checks 1, 2, 5, 7: one visible-text sweep -------------------------
  if (!skipped.has('type') && !skipped.has('contrast') && !skipped.has('raw-text')) {
    checks['type'] = 'pass'
    checks['contrast'] = 'pass'
    checks['raw-text'] = 'pass'
  } else {
    if (skipped.has('type')) checks['type'] = 'skip'
    if (skipped.has('contrast')) checks['contrast'] = 'skip'
    if (skipped.has('raw-text')) checks['raw-text'] = 'skip'
  }
  if (!skipped.has('type') || !skipped.has('contrast') || !skipped.has('raw-text')) {
    const nodes = await page.evaluate((): TextNodeRecord[] => {
      const out: TextNodeRecord[] = []
      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) return false
        if (element.closest('[aria-hidden="true"]')) return false
        const style = getComputedStyle(element)
        if (style.visibility === 'hidden' || style.display === 'none') return false
        return element.offsetParent !== null || style.position === 'fixed'
      }
      const selectorFor = (element: Element): string => {
        const parts: string[] = []
        let current: Element | null = element
        for (let depth = 0; current && depth < 4; depth++) {
          const tag = current.tagName.toLowerCase()
          const parent: Element | null = current.parentElement
          const index = parent ? [...parent.children].filter((child) => child.tagName === current?.tagName).indexOf(current) + 1 : 1
          parts.unshift(`${tag}:nth-of-type(${index})`)
          current = parent
        }
        return parts.join(' > ')
      }
      const alphaOf = (color: string): number | null => {
        const rgb = /^rgba?\(([^)]+)\)$/.exec(color)
        if (rgb) {
          const channels = rgb[1]?.split(',').map((part) => Number(part.trim())) ?? []
          if (channels.length === 3) return 1
          if (channels.length === 4 && Number.isFinite(channels[3])) return channels[3] as number
          return null
        }
        // Chromium serializes token colours as oklch(), and colours that
        // passed through color-mix as oklab(); alpha rides after /.
        if (/^oklch\(/.test(color) || /^oklab\(/.test(color)) {
          const slash = /^(?:oklch|oklab)\([^)]*\/\s*([\d.]+%?)\s*\)$/.exec(color)
          if (!slash) return 1
          const raw = slash[1] ?? ''
          const alpha = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
          return Number.isFinite(alpha) ? alpha : null
        }
        return null
      }
      const opaqueBackground = (element: Element): string | null => {
        let current: Element | null = element
        while (current) {
          const background = getComputedStyle(current).backgroundColor
          if ((alphaOf(background) ?? 0) >= 1) return background
          current = current.parentElement
        }
        return null
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node: Node | null = walker.nextNode()
      while (node && out.length < 3000) {
        const text = node.textContent ?? ''
        if (text.trim()) {
          const parent = node.parentElement
          if (parent && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName) && isVisible(parent)) {
            const style = getComputedStyle(parent)
            out.push({
              selector: selectorFor(parent),
              weight: style.fontWeight,
              size: Number.parseFloat(style.fontSize),
              color: style.color,
              background: opaqueBackground(parent),
              text: text.trim().slice(0, 120),
              markdownStrong: parent.closest('strong') !== null && parent.closest('[data-markdown]') !== null,
            })
          }
        }
        node = walker.nextNode()
      }
      return out
    })
    for (const record of nodes) {
      if (!skipped.has('type')) {
        const weight = normalizeWeight(record.weight)
        if (!(weight === 400 || weight === 500 || (weight === 600 && record.markdownStrong))) {
          fail('type', record.selector, `weight ${weight} on "${record.text}"`)
          checks['type'] = 'fail'
        }
        if (![...ALLOWED_SIZES].some((size) => Math.abs(size - record.size) < 0.15)) {
          fail('type', record.selector, `size ${record.size}px on "${record.text}"`)
          checks['type'] = 'fail'
        }
      }
      if (!skipped.has('contrast')) {
        const foreground = parseCssColor(record.color)
        const background = record.background ? parseCssColor(record.background) : null
        if (!foreground || !background || background.alpha < 1) {
          fail('contrast', record.selector, `uncomputable pair for "${record.text}" (${record.color} on ${record.background})`)
          checks['contrast'] = 'fail'
        } else {
          let effective = foreground
          if (foreground.alpha < 1) {
            const mix = (fg: number, bg: number): number => Math.round(fg * foreground.alpha + bg * (1 - foreground.alpha))
            effective = { r: mix(foreground.r, background.r), g: mix(foreground.g, background.g), b: mix(foreground.b, background.b), alpha: 1 }
          }
          const ratio = contrastRatio(effective, background)
          const threshold = record.size >= 18.66 ? 3 : 4.5
          if (ratio < threshold) {
            fail('contrast', record.selector, `ratio ${ratio.toFixed(2)} < ${threshold} on "${record.text}" (${record.color} on ${record.background})`)
            checks['contrast'] = 'fail'
          }
        }
      }
      if (!skipped.has('raw-text')) {
        const hit = RAW_TEXT.exec(record.text)
        if (hit) {
          fail('raw-text', record.selector, `raw key "${hit[0]}" in "${record.text}"`)
          checks['raw-text'] = 'fail'
        }
        if (record.text.includes('—')) {
          fail('raw-text', record.selector, `em dash in "${record.text}"`)
          checks['raw-text'] = 'fail'
        }
      }
    }
  }

  // -- check 3: no horizontal overflow ------------------------------------
  if (skipped.has('overflow')) checks['overflow'] = 'skip'
  else {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    checks['overflow'] = overflow <= 0 ? 'pass' : 'fail'
    if (overflow > 0) fail('overflow', 'html', `scrollWidth exceeds viewport by ${overflow}px`)
  }

  // -- check 4: names + target sizes --------------------------------------
  if (skipped.has('targets')) checks['targets'] = 'skip'
  else {
    checks['targets'] = 'pass'
    const viewportWidth = page.viewportSize()?.width ?? 1440
    const minimum = viewportWidth <= 480 ? 40 : 32
    const focusables = await page.evaluate((): Array<{ selector: string; name: string; width: number; height: number; inlineLink: boolean }> => {
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${element.id}`
        const parts: string[] = []
        let current: Element | null = element
        for (let depth = 0; current && depth < 3; depth++) {
          parts.unshift(current.tagName.toLowerCase())
          current = current.parentElement
        }
        return parts.join(' > ')
      }
      const labelledBy = (element: Element): string => {
        const ref = element.getAttribute('aria-labelledby')
        if (!ref) return ''
        return ref.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim()
      }
      const labelled = (element: Element): string => {
        const explicit = element.closest('label')?.textContent?.trim() ?? ''
        const id = element.id
        const associated = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ?? '' : ''
        return explicit || associated
      }
      const out: Array<{ selector: string; name: string; width: number; height: number; inlineLink: boolean }> = []
      const candidates = document.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="menuitem"], input, select, textarea')
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) continue
        const style = getComputedStyle(candidate)
        if (style.visibility === 'hidden' || style.display === 'none') continue
        if (candidate.offsetParent === null && style.position !== 'fixed') continue
        if (candidate.closest('[aria-hidden="true"]')) continue
        let rect = candidate.getBoundingClientRect()
        const role = candidate.getAttribute('role')
        const inputType = candidate instanceof HTMLInputElement ? candidate.type : ''
        if (inputType === 'checkbox' || inputType === 'radio' || role === 'checkbox' || role === 'switch') {
          // The label toggles the control, so the union is the real target.
          const label = candidate.closest('label') ?? (candidate.id ? document.querySelector(`label[for="${CSS.escape(candidate.id)}"]`) : null)
          if (label instanceof HTMLElement) {
            const labelRect = label.getBoundingClientRect()
            const left = Math.min(rect.left, labelRect.left)
            const top = Math.min(rect.top, labelRect.top)
            const right = Math.max(rect.right, labelRect.right)
            const bottom = Math.max(rect.bottom, labelRect.bottom)
            rect = new DOMRect(left, top, right - left, bottom - top)
          }
        }
        const name = candidate.getAttribute('aria-label')?.trim()
          || labelledBy(candidate)
          || labelled(candidate)
          || (candidate instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(candidate.type) ? candidate.value : '')
          || candidate.textContent?.trim()
          || candidate.getAttribute('title')?.trim()
          || (candidate instanceof HTMLImageElement ? candidate.alt : '')
          || ''
        out.push({
          selector: selectorFor(candidate),
          name,
          width: rect.width,
          height: rect.height,
          // Breadcrumb crumbs are inline navigational text (WCAG 2.5.8 inline
          // exception) whether rendered as links or buttons; scope stays here.
          inlineLink:
            (candidate.tagName === 'A' && style.display === 'inline') ||
            (candidate.tagName === 'BUTTON' && candidate.closest('nav[aria-label="Breadcrumb"]') !== null),
        })
      }
      return out
    })
    for (const focusable of focusables) {
      if (!focusable.name) {
        fail('targets', focusable.selector, 'focusable element has no accessible name')
        checks['targets'] = 'fail'
      }
      if (!focusable.inlineLink && (focusable.width < minimum - 0.5 || focusable.height < minimum - 0.5)) {
        fail('targets', focusable.selector, `target ${focusable.width.toFixed(0)}x${focusable.height.toFixed(0)} below ${minimum}px ("${focusable.name}")`)
        checks['targets'] = 'fail'
      }
    }
  }

  // -- check 6: inset rounded hover ---------------------------------------
  if (skipped.has('hover')) checks['hover'] = 'skip'
  else {
    // data-list-row only: bare tbody tr matches non-interactive
    // Markdown table rows, which carry no hover contract (DataTable body
    // rows already carry data-list-row, stacked 390 included).
    const rowSelector = '[data-list-row]:visible'
    const candidates = page.locator(rowSelector)
    // Skeletons are aria-hidden placeholders and colspan state rows are
    // panels, not hoverable rows. Rows a full-screen dock/dialog covers
    // are not hoverable either (hovering one hangs touch actionability on
    // the occluded point): walk to the first HITTABLE row, centering each
    // candidate first so sticky edges do not fake an occlusion. Views
    // without one skip the check.
    let rowIndex = -1
    for (let i = 0, count = await candidates.count(); i < count; i++) {
      const measurable = await candidates
        .nth(i)
        .evaluate((element) => element.closest('[aria-hidden="true"]') === null && element.querySelector('td[colspan]') === null)
      if (!measurable) continue
      await candidates.nth(i).evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const hittable = await candidates.nth(i).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return top !== null && (element === top || element.contains(top))
      })
      if (hittable) {
        rowIndex = i
        break
      }
    }
    if (rowIndex === -1) checks['hover'] = 'skip'
    else {
      const row = candidates.nth(rowIndex)
      checks['hover'] = 'pass'
      await row.hover()
      const measurement = await row.evaluate((element) => {
        const style = getComputedStyle(element)
        const before = getComputedStyle(element, '::before')
        const rect = element.getBoundingClientRect()
        const card = element.closest('[data-card]')
        const cardRect = card?.getBoundingClientRect() ?? null
        const cardStyle = card ? getComputedStyle(card) : null
        const cardBorderLeft = cardStyle ? Number.parseFloat(cardStyle.borderLeftWidth) || 0 : 0
        const cardPaddingLeft = cardStyle ? Number.parseFloat(cardStyle.paddingLeft) || 0 : 0
        // First rendered text run: child elements mislead for table rows
        // (cells start at the row edge; their px-2 padding is inside).
        let textInset: number | null = null
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let textNode: Node | null = walker.nextNode()
        while (textNode && textInset === null) {
          if (textNode.textContent?.trim()) {
            const range = document.createRange()
            range.selectNodeContents(textNode)
            const rects = range.getClientRects()
            for (let i = 0; i < rects.length; i++) {
              const textRect = rects[i] as DOMRect
              if (textRect.width > 0 && textRect.height > 0) {
                textInset = textRect.left - rect.left
                break
              }
            }
          }
          textNode = walker.nextNode()
        }
        return {
          radius: Number.parseFloat(style.borderRadius),
          borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
          // Stacked table rows (390) are self-framed cards spanning the
          // content width: no card-inset contract, but they must carry
          // card chrome (border + 8px radius) instead of a bare highlight.
          stacked: element.tagName === 'TR' && style.display !== 'table-row',
          // Highlight inset from the card border edge: the 2.5.1 recipe
          // pulls the list 8px out of the 16px card padding, so the
          // highlight sits 8px inside the border (never touching it). A
          // de-chromed wrapper carries no inset contract either.
          insetLeft: cardRect && (cardBorderLeft > 0 || cardPaddingLeft > 0) ? rect.left - cardRect.left - cardBorderLeft : null,
          textInset,
          dividerOpacity: before.content === 'none' ? null : Number.parseFloat(before.opacity),
        }
      })
      if (!(measurement.radius >= (measurement.stacked ? 8 : 4))) { fail('hover', rowSelector, `row radius ${measurement.radius}px`); checks['hover'] = 'fail' }
      if (measurement.stacked && !(measurement.borderWidth >= 1)) { fail('hover', rowSelector, 'stacked row has no card border'); checks['hover'] = 'fail' }
      if (!measurement.stacked && measurement.insetLeft !== null && measurement.insetLeft < 3.5) { fail('hover', rowSelector, `row inset ${measurement.insetLeft.toFixed(1)}px from card edge`); checks['hover'] = 'fail' }
      if (measurement.textInset !== null && measurement.textInset < 7) { fail('hover', rowSelector, `text ${measurement.textInset.toFixed(1)}px inside highlight`); checks['hover'] = 'fail' }
      if (measurement.dividerOpacity !== null && measurement.dividerOpacity > 0.05) { fail('hover', rowSelector, `divider opacity ${measurement.dividerOpacity} while hovered`); checks['hover'] = 'fail' }
    }
  }

  // -- check 8: keyboard focus ring ---------------------------------------
  if (skipped.has('focus')) checks['focus'] = 'skip'
  else {
    checks['focus'] = 'pass'
    await page.locator('body').click({ position: { x: 4, y: 4 }, timeout: 5_000 }).catch(() => undefined)
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const active = document.activeElement
        if (!active || active === document.body) return null
        const style = getComputedStyle(active)
        return {
          selector: active.id ? `#${active.id}` : active.tagName.toLowerCase(),
          outline: Number.parseFloat(style.outlineWidth),
          shadow: style.boxShadow,
        }
      })
      if (!focused) break
      if (!(focused.outline >= 2 || (focused.shadow !== 'none' && focused.shadow !== ''))) {
        fail('focus', focused.selector, 'no visible focus ring while tabbing')
        checks['focus'] = 'fail'
      }
    }
    // The last Tab's 400ms tooltip open-delay may still be pending:
    // settle it BEFORE Escape+blur, or the timer fires mid-clear and a
    // healthy tooltip fails as stuck. A tooltip still mounted after
    // open-settle + Escape + blur + the exit wait below is genuinely
    // stuck: fail loud, it needs a product fix. (Tab-opened tooltips also
    // keep stale coordinates across resizes and fake overflow, hence the
    // blur discipline.)
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    // Count-based (a bare locator waitFor crashes on 2+ simultaneous
    // tooltips: one exiting, one open). Still fails loud past 3s.
    await page.waitForFunction(() => document.querySelectorAll('[role="tooltip"]').length === 0, null, { timeout: 3000 })
  }

  // -- check 9: h1 alignment ----------------------------------------------
  if (skipped.has('alignment')) checks['alignment'] = 'skip'
  else {
    const selector = options.sectionSelector ?? '[data-page-section], section'
    const aligned = await page.evaluate((sectionQuery: string) => {
      const heading = document.querySelector('h1')
      const target = document.querySelector(sectionQuery)
      if (!heading || !target) return null
      return { heading: heading.getBoundingClientRect().left, section: target.getBoundingClientRect().left }
    }, selector)
    if (!aligned) checks['alignment'] = 'skip'
    else if (Math.abs(aligned.heading - aligned.section) <= 1) checks['alignment'] = 'pass'
    else {
      checks['alignment'] = 'fail'
      fail('alignment', 'h1', `h1 x=${aligned.heading.toFixed(1)} vs section x=${aligned.section.toFixed(1)}`)
    }
  }

  // -- check 10: plan rail vs medallions -----------------------------------
  if (skipped.has('plan-rail')) checks['plan-rail'] = 'skip'
  else {
    const collision = await page.evaluate(() => {
      const medallions = [...document.querySelectorAll('[data-plan-medallion]')].map((element) => element.getBoundingClientRect())
      const segments = [...document.querySelectorAll('[data-plan-rail-segment]')].map((element) => element.getBoundingClientRect())
      if (!medallions.length || !segments.length) return null
      for (const segment of segments) {
        for (const medallion of medallions) {
          const overlapX = Math.min(segment.right, medallion.right) - Math.max(segment.left, medallion.left)
          const overlapY = Math.min(segment.bottom, medallion.bottom) - Math.max(segment.top, medallion.top)
          if (overlapX > 0.5 && overlapY > 0.5) return true
        }
      }
      return false
    })
    if (collision === null) checks['plan-rail'] = 'skip'
    else if (!collision) checks['plan-rail'] = 'pass'
    else {
      checks['plan-rail'] = 'fail'
      fail('plan-rail', '[data-plan-rail-segment]', 'a rail segment intersects a medallion')
    }
  }

  return { violations, checks }
}

export function formatViolations(result: AuditResult): string {
  if (!result.violations.length) return 'audit clean'
  const grouped = new Map<string, AuditViolation[]>()
  for (const violation of result.violations) {
    grouped.set(violation.check, [...(grouped.get(violation.check) ?? []), violation])
  }
  return [...grouped.entries()].map(([check, rows]) => `${check} (${rows.length}):\n${rows.slice(0, 12).map((row) => `  - ${row.selector}: ${row.detail}`).join('\n')}`).join('\n')
}

export async function writeAuditReport(name: string, result: AuditResult): Promise<string> {
  mkdirSync(V2_AUDIT, { recursive: true })
  const file = resolve(V2_AUDIT, `${name}.json`)
  writeFileSync(file, JSON.stringify({ name, at: new Date().toISOString(), checks: result.checks, violations: result.violations }, null, 2))
  return file
}
