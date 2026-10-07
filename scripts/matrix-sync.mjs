// Matrix spec generator (P6.3): reads frontend `states:` from
// tests/registry/features.yaml + case data from
// tests/frontend-e2e/matrix/components.json, writes one
// tests/frontend-e2e/matrix/<component>.spec.ts per component.
// Run: npm run matrix:sync. Fails loud on unknown states, missing cases,
// missing emptyAnchors, static fault states, or filename collisions.
// light/w1440 are the recorded default env: no separate test is emitted.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectedCountTexts, expectedRowCount } from '../tests/frontend-e2e/matrix/counts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = join(ROOT, 'tests/registry/features.yaml')
const CASES = join(ROOT, 'tests/frontend-e2e/matrix/components.json')
const OUT_DIR = join(ROOT, 'tests/frontend-e2e/matrix')

const DATA_STATES = new Set([
  'loading', 'empty', 'one', 'typical', 'n100', 'n1000',
  'error', 'denied', 'offline', 'partial', 'longtext',
])
const ENV_STATES = new Set(['dark', 'w1280', 'w768', 'w390', 'focus', 'reduced-motion'])
const DEFAULT_ENV = new Set(['light', 'w1440'])

const CONTENT = {
  resource: {
    loading: [{ kind: 'role', role: 'status' }],
    error: [
      { kind: 'role', role: 'alert' },
      { kind: 'role', role: 'button', name: 'Try again' },
    ],
    denied: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'Ask an owner for access, then try again.' },
      { kind: 'role', role: 'button', name: 'Try again' },
    ],
    offline: [
      { kind: 'text', text: 'No connection. Reconnect and try again.' },
      { kind: 'role', role: 'button', name: 'Try again' },
    ],
  },
  direct: {
    loading: [{ kind: 'role', role: 'status' }],
    error: [
      { kind: 'role', role: 'alert' },
      { kind: 'role', role: 'button', name: 'Try again' },
    ],
    denied: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'Ask an owner for access, then try again.' },
      { kind: 'role', role: 'button', name: 'Try again' },
    ],
    offline: [
      { kind: 'text', text: 'No connection' },
      { kind: 'role', role: 'button', name: 'Try again' },
    ],
  },
}

function loadRegistryStates() {
  const lines = readFileSync(REGISTRY, 'utf8').split('\n')
  const out = new Map()
  let id = null
  let block = null
  const flush = () => {
    if (id && block) out.set(id, block)
    id = null
    block = null
  }
  for (const line of lines) {
    const idMatch = /^- id: (frontend\.\S+)/.exec(line)
    if (idMatch) {
      flush()
      id = idMatch[1]
      continue
    }
    if (/^- id: /.test(line)) {
      flush()
      continue
    }
    const stMatch = /^  states: \[(.*)\]/.exec(line)
    if (stMatch && id) {
      out.set(id, stMatch[1].split(',').map((s) => s.trim()).filter(Boolean))
      id = null
      continue
    }
    if (/^  states: \[\]$/.test(line) && id) {
      out.set(id, [])
      id = null
      continue
    }
    if (/^  states:$/.test(line) && id) {
      block = []
      continue
    }
    const itemMatch = /^    - (\S+)/.exec(line)
    if (itemMatch && block) {
      block.push(itemMatch[1])
      continue
    }
    if (block && /^\S/.test(line)) flush()
  }
  flush()
  return out
}

function fileSafe(id) {
  return id
    .replace(/^frontend\.src\.components\./, '')
    .replace(/^frontend\.hook\./, 'hook-')
    .replace(/\./g, '-')
}

function shortName(id) {
  return id.slice(id.lastIndexOf('.') + 1)
}

function main() {
  const states = loadRegistryStates()
  const cases = JSON.parse(readFileSync(CASES, 'utf8'))
  delete cases._comment
  const errors = []

  for (const [id, list] of states) {
    if (list.length === 0) continue
    if (!cases[id]) errors.push(`${id}: has states but no components.json entry`)
    for (const s of list) {
      if (!DATA_STATES.has(s) && !ENV_STATES.has(s) && !DEFAULT_ENV.has(s)) {
        errors.push(`${id}: unknown state '${s}'`)
      }
    }
  }
  for (const id of Object.keys(cases)) {
    if (!states.has(id)) errors.push(`${id}: components.json entry without registry entry`)
    else if (states.get(id).length === 0) errors.push(`${id}: components.json entry but empty states`)
  }
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exit(1)
  }

  const seen = new Map()
  let emitted = 0
  for (const [id, list] of states) {
    if (list.length === 0) continue
    const mc = cases[id]
    const name = fileSafe(id)
    if (seen.has(name)) {
      console.error(`filename collision: ${id} and ${seen.get(name)} both map to ${name}`)
      process.exit(1)
    }
    seen.set(name, id)

    const tests = []
    let needsFactory = false
    for (const state of list) {
      if (DEFAULT_ENV.has(state)) continue
      let anchors = mc.anchors
      // Gated surfaces (dock, dialog, palette) render their content only
      // after setup opens them, so per-state content anchors move to a
      // post-setup postAnchors override; anchors stays the trigger.
      let post = null
      let faultGated = false
      if (state === 'empty') {
        if (!mc.emptyAnchors) {
          console.error(`${id}: empty state needs emptyAnchors`)
          process.exit(1)
        }
        if (mc.gated) post = mc.emptyAnchors
        else anchors = mc.emptyAnchors
      } else if (state === 'loading' || state === 'error' || state === 'denied' || state === 'offline') {
        if (mc.family === 'static' && state !== 'loading') {
          console.error(`${id}: static family cannot assert ${state}`)
          process.exit(1)
        }
        if (mc.family !== 'static') {
          if (mc.gated) {
            post = CONTENT[mc.family][state]
            // Fault/loading UI replaces the surface content but not the
            // surface itself: assert the surface marker (postAnchors[0],
            // the dock/dialog by convention) plus the CONTENT anchors,
            // not the replaced content anchors.
            faultGated = true
          } else anchors = CONTENT[mc.family][state]
        }
      }
      // P6-M4: count states assert rows + totals, longtext asserts snippets.
      const extras = []
      const count = mc.rows ? expectedRowCount(id, mc.primary, state) : null
      if (count !== null && count !== undefined) {
        extras.push(`expectedRows: { selector: ${JSON.stringify(mc.rows)}, count: ${count} }`)
      }
      const parts = expectedCountTexts(id, mc.primary, state, mc.countText).map(
        (t) => `{ text: ${JSON.stringify(t.text)}, exact: true }`,
      )
      if (state === 'longtext') {
        parts.push(`...longtextSnippets(${JSON.stringify(mc.primary)})`)
        needsFactory = true
      }
      if (parts.length > 0) extras.push(`expectedTexts: [${parts.join(', ')}]`)
      if (post) {
        const kept = faultGated && mc.postAnchors?.length > 0 ? [mc.postAnchors[0]] : [...(mc.postAnchors ?? [])]
        extras.push(`postAnchors: ${JSON.stringify([...kept, ...post])}`)
      }
      tests.push(
        `test('[F:${id}] ${shortName(id)} ${state}', async ({ page }) => {\n` +
        `  await runMatrixState(page, { ...base, anchors: ${JSON.stringify(anchors)}${extras.length > 0 ? `, ${extras.join(', ')}` : ''} }, '${state}')\n` +
        `})`,
      )
    }

    const base = { id, route: mc.route }
    if (mc.gated) base.gated = true
    if (mc.setup) base.setup = mc.setup
    if (mc.postAnchors) base.postAnchors = mc.postAnchors
    if (mc.focusSubject) base.focusSubject = mc.focusSubject
    base.primary = mc.primary
    if (mc.secondary) base.secondary = mc.secondary
    if (mc.envBasis) base.envBasis = mc.envBasis
    if (mc.sectorState) base.sectorState = mc.sectorState
    if (mc.localVariant) base.localVariant = mc.localVariant

    const body =
      `// GENERATED by npm run matrix:sync from tests/registry/features.yaml (states)\n` +
      `// + tests/frontend-e2e/matrix/components.json. Do not edit.\n` +
      `import { test } from '@playwright/test'\n` +
      `import { runMatrixState, type MatrixCase } from '../support/matrix'\n` +
      (needsFactory ? `import { longtextSnippets } from '../support/factory'\n` : '') + `\n` +
      `const base: Omit<MatrixCase, 'anchors'> = ${JSON.stringify(base, null, 2)}\n\n` +
      tests.join('\n\n') +
      `\n`
    writeFileSync(join(OUT_DIR, `${name}.spec.ts`), body)
    emitted += tests.length
  }

  const stale = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.spec.ts') && ![...seen.keys()].includes(f.slice(0, -'.spec.ts'.length)))
  console.log(`matrix-sync: ${seen.size} specs, ${emitted} tests`)
  if (stale.length > 0) console.log(`stale specs (kept, not deleted): ${stale.join(', ')}`)
}

main()
