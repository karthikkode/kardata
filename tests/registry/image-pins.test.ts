// P4/P7 minor: toxiproxy is pinned by digest (same pin in CI and the
// stack script), never :latest.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const PIN = 'shopify/toxiproxy@sha256:a6b080af39986b863a1f7c5a3b9bacf2afeb48abab8f0eb7e243f8f7ad38c645'

describe('toxiproxy image pin', () => {
  it('CI and stack.mjs use the pinned digest, not :latest', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
    const stack = readFileSync(join(ROOT, 'deployment', 'scripts', 'stack.mjs'), 'utf8')
    expect(ci).toContain(PIN)
    expect(stack).toContain(PIN)
    expect(ci).not.toContain('shopify/toxiproxy:latest')
    expect(stack).not.toContain('shopify/toxiproxy:latest')
  })
})
