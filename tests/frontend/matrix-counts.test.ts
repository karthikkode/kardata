// P6-M4: matrix count states assert row counts + totals, and longtext
// asserts the 300-char name and the unbroken URL. Pins the counts.mjs
// derivations and that components.json drives them into the specs.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expectedCountTexts, expectedRowCount } from '../frontend-e2e/matrix/counts.mjs'
import {
  LONG_MESSAGE_5K,
  LONG_NAME_300,
  UNBROKEN_URL,
  longtextSnippets,
} from '../frontend-e2e/support/factory'

const ROOT = join(import.meta.dirname, '..', '..')
const CASES = JSON.parse(
  readFileSync(join(ROOT, 'tests', 'frontend-e2e', 'matrix', 'components.json'), 'utf8'),
) as Record<string, { rows?: string; countText?: string; primary: string }>
delete (CASES as Record<string, unknown>)._comment

const P = 'frontend.src.components.'
const CHAT_LOG = `${P}chat.ChatLog`
const MESSAGE_BUBBLE = `${P}chat.MessageBubble`
const COMPANIES = `${P}CompaniesSection`
const RESEARCHES = `${P}ResearchesPage`
const PARTS = `${P}research_parts`
const RUNS = `${P}RunsPanel`
const SUBAGENTS = `${P}SubagentsPanel`
const SESSIONS = `${P}chat.SessionsPanel`
const WORKSPACE = `${P}SectorWorkspace`
const DASHBOARD = `${P}Dashboard`

function registryStates(): Map<string, string[]> {
  const lines = readFileSync(join(ROOT, 'tests', 'registry', 'features.yaml'), 'utf8').split('\n')
  const out = new Map<string, string[]>()
  let id: string | null = null
  let block: string[] | null = null
  const flush = () => {
    if (id && block) out.set(id, block)
    id = null
    block = null
  }
  for (const line of lines) {
    const idMatch = /^- id: (frontend\.\S+)/.exec(line)
    if (idMatch) {
      flush()
      id = idMatch[1] as string
      continue
    }
    if (/^- id: /.test(line)) {
      flush()
      continue
    }
    const inline = /^[ ]{2}states: \[(.*)\]/.exec(line)
    if (inline && id) {
      out.set(
        id,
        (inline[1] as string).split(',').map((s) => s.trim()).filter(Boolean),
      )
      id = null
      continue
    }
    if (/^[ ]{2}states:$/.test(line) && id) {
      block = []
      continue
    }
    const item = /^[ ]{4}- (\S+)/.exec(line)
    if (item && block) {
      block.push(item[1] as string)
      continue
    }
    if (block && /^\S/.test(line)) flush()
  }
  flush()
  return out
}

describe('1000-row render', () => {
  it('messages drain all pages: ChatLog + MessageBubble render 1000 bubbles', () => {
    for (const id of [CHAT_LOG, MESSAGE_BUBBLE]) {
      expect(CASES[id]?.rows).toBe('[aria-label="Chat messages"] [data-message-bubble]')
      expect(expectedRowCount(id, 'messages', 'n1000')).toBe(1000)
    }
  })

  it('companies render the first 100 window plus the total', () => {
    expect(CASES[COMPANIES]?.rows).toBe('table[aria-label="Companies"] [data-list-row]')
    expect(expectedRowCount(COMPANIES, 'companies', 'n1000')).toBe(100)
    expect(expectedCountTexts(COMPANIES, 'companies', 'n1000', CASES[COMPANIES]?.countText)).toEqual([
      { text: 'Showing 100 of 1,000', exact: true },
    ])
  })

  it('sectors render the 50-row window plus the total', () => {
    expect(CASES[RESEARCHES]?.rows).toBe('table[aria-label="Sectors"] [data-list-row]')
    expect(expectedRowCount(RESEARCHES, 'sectors', 'n1000')).toBe(50)
    expect(expectedCountTexts(RESEARCHES, 'sectors', 'n1000', CASES[RESEARCHES]?.countText)).toEqual([
      { text: 'Showing 50 of 1,000', exact: true },
    ])
  })

  it('subagent toggle reads the count (list closed by default)', () => {
    expect(CASES[SUBAGENTS]?.countText).toBe('{n} subagents')
    expect(expectedRowCount(SUBAGENTS, 'threads', 'n1000')).toBeNull()
    expect(expectedCountTexts(SUBAGENTS, 'threads', 'n1000', CASES[SUBAGENTS]?.countText)).toEqual([
      { text: '1000 subagents', exact: true },
    ])
  })
})

describe('longtext', () => {
  it('fixtures are 300 and 5000 chars', () => {
    expect(LONG_NAME_300).toHaveLength(300)
    expect(LONG_MESSAGE_5K).toHaveLength(5000)
  })

  it('messages longtext asserts the 5k text and the unbroken URL', () => {
    const snippets = longtextSnippets('messages')
    expect(snippets).toHaveLength(2)
    const message = snippets[0] as { text: string; exact: boolean }
    const url = snippets[1] as { text: string; exact: boolean }
    expect(LONG_MESSAGE_5K.startsWith(message.text)).toBe(true)
    expect(message.text.length).toBeGreaterThan(50)
    expect(UNBROKEN_URL.startsWith(url.text)).toBe(true)
    expect(url.text.length).toBeGreaterThan(50)
  })

  it('name longtext asserts the 300-char name', () => {
    for (const primary of ['companies', 'sectors', 'sector']) {
      const snippets = longtextSnippets(primary)
      expect(snippets).toHaveLength(1)
      const only = snippets[0] as { text: string; exact: boolean }
      expect(LONG_NAME_300.startsWith(only.text)).toBe(true)
      expect(only.text.length).toBeGreaterThan(50)
    }
  })

  it('every longtext case has snippets for its primary', () => {
    const ids = [
      COMPANIES,
      DASHBOARD,
      `${P}Markdown`,
      RESEARCHES,
      `${P}SectorLanding`,
      WORKSPACE,
      CHAT_LOG,
      MESSAGE_BUBBLE,
    ]
    for (const id of ids) {
      expect(longtextSnippets(CASES[id]?.primary as string).length, id).toBeGreaterThan(0)
    }
  })
})

describe('derived counts', () => {
  it('pins the windowed/derived counts', () => {
    expect(expectedRowCount(CHAT_LOG, 'messages', 'typical')).toBe(28) // showcase texts
    expect(expectedRowCount(CHAT_LOG, 'messages', 'n100')).toBe(100)
    expect(expectedRowCount(RESEARCHES, 'sectors', 'n100')).toBe(50)
    expect(expectedCountTexts(RESEARCHES, 'sectors', 'n100', undefined)).toEqual([
      { text: 'Showing 50 of 100', exact: true },
    ])
    expect(expectedRowCount(SESSIONS, 'sessions', 'typical')).toBe(8)
    expect(expectedRowCount(SESSIONS, 'sessions', 'n100')).toBe(100)
    expect(expectedRowCount(WORKSPACE, 'sessions', 'typical')).toBe(12)
    expect(expectedRowCount(WORKSPACE, 'sessions', 'partial')).toBe(7)
    expect(expectedRowCount(DASHBOARD, 'sectors', 'typical')).toBe(6)
    expect(expectedRowCount(DASHBOARD, 'sectors', 'partial')).toBe(1)
    expect(expectedRowCount(RUNS, 'runs', 'one')).toBe(1)
    expect(expectedRowCount(RUNS, 'runs', 'typical')).toBe(8)
    expect(expectedRowCount(PARTS, 'sectors', 'typical')).toBe(8)
  })
})

describe('coverage', () => {
  const OMITTED: Record<string, string> = {
    [`${P}ChatPanel`]: 'sessions panel closed by default: no rows in DOM',
    [`${P}ModelsPanel`]: 'sessions feed binding text, render no rows',
  }
  // Row-count states are the count states: a list declares one/n100/n1000
  // (and partial where it renders one). Bare `typical` is a content state
  // for non-lists (primitives, dialogs, shells), never rows, so it does
  // not require a rows/countText drive. SectorLanding/Markdown omits were
  // subsumed by this rule.
  const ROW_STATES = new Set(['one', 'n100', 'n1000', 'partial'])

  it('every row-state case drives rows or is a documented omit', () => {
    const states = registryStates()
    const missing: string[] = []
    for (const [id, list] of states) {
      if (!list.some((s) => ROW_STATES.has(s))) continue
      if (OMITTED[id]) continue
      const mc = CASES[id]
      if (!mc || (!mc.rows && !mc.countText)) missing.push(id)
    }
    expect(missing).toEqual([])
    for (const id of Object.keys(OMITTED)) {
      expect((states.get(id) ?? []).some((s) => ROW_STATES.has(s)), `${id} omit is stale`).toBe(true)
    }
  })
})
