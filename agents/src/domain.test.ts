import { describe, expect, it } from 'vitest'
import { domainTools } from './domain.js'
import { ToolRegistry, dispatch, type ToolContext } from './tools.js'
import { frozenClock } from './clock.js'

function ctx(name: string): ToolContext {
  return { toolCallId: 'c1', toolName: name, clock: frozenClock(0), signal: new AbortController().signal }
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry()
  for (const tool of domainTools()) tools.register(tool)
  return tools
}

describe('domainTools [F:agents.domain.domainTools]', () => {
  it('lists sectors and filters companies by sector', async () => {
    const tools = registry()
    const sectors = await dispatch(tools, { id: 'c1', name: 'sector.list', args: {} }, ctx('sector.list'))
    expect(sectors.isError).toBe(false)
    expect(JSON.parse(sectors.content)).toHaveLength(2)
    const companies = await dispatch(
      tools,
      { id: 'c2', name: 'company.list', args: { sectorId: 'sector-fintech' } },
      ctx('company.list'),
    )
    expect(JSON.parse(companies.content).map((co: { id: string }) => co.id)).toEqual(['co-1', 'co-2', 'co-3'])
    const empty = await dispatch(
      tools,
      { id: 'c3', name: 'company.list', args: { sectorId: 'sector-health' } },
      ctx('company.list'),
    )
    expect(JSON.parse(empty.content)).toEqual([])
  })

  it('searches, fetches, and captures evidence with provenance', async () => {
    const tools = registry()
    const found = await dispatch(
      tools,
      { id: 'c1', name: 'documents.search', args: { query: 'acme' } },
      ctx('documents.search'),
    )
    expect(JSON.parse(found.content).map((doc: { id: string }) => doc.id)).toEqual(['doc-1'])
    const fetched = await dispatch(tools, { id: 'c2', name: 'documents.get', args: { id: 'doc-1' } }, ctx('documents.get'))
    expect(fetched.isError).toBe(false)
    const missing = await dispatch(tools, { id: 'c3', name: 'documents.get', args: { id: 'nope' } }, ctx('documents.get'))
    expect(missing.isError).toBe(true)
    const evidence = await dispatch(
      tools,
      { id: 'c4', name: 'evidence.capture', args: { docId: 'doc-1', excerpt: 'founded 2020' } },
      ctx('evidence.capture'),
    )
    const item = JSON.parse(evidence.content)
    expect(item).toMatchObject({ docId: 'doc-1', url: 'https://example.com/acme', excerpt: 'founded 2020' })
  })

  it('searches snippets without fetching', async () => {
    const tools = registry()
    const result = await dispatch(
      tools,
      { id: 'c1', name: 'hound.search', args: { query: 'pay' } },
      ctx('hound.search'),
    )
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content)).toHaveLength(2)
  })
})
