import { describe, expect, it } from 'vitest'
import type { TurnRunnerMcpClient } from '@kardata/agents'
import { freezeOriginalPalette, PRODUCT_TOOLS, productMcpClient, RESEARCH_TOOLS, researchMcpClient, SECTOR_TOOLS, sectorMcpClient, turnPalette } from '../../backend/src/temporal/activities/turn-palettes.js'

const NEW_OPS = [
  'ops.list_runs', 'ops.get_run', 'ops.thread_queue', 'ops.queue_remove', 'ops.queue_reorder',
  'ops.list_alerts', 'ops.thread_health', 'ops.cost', 'ops.sector_evaluation', 'ops.recent_activity',
  'ops.pause_run', 'ops.resume_run', 'ops.cancel_run', 'ops.spawn_subagent', 'ops.restart_sector_research',
  'ops.start_monitor', 'ops.stop_monitor', 'ops.list_monitors',
]
const SECTOR_OPS = ['ops.thread_health', 'ops.cost', 'ops.list_alerts', 'ops.spawn_subagent']

describe('ops tool palette membership [F:backend.activity.turn_palettes.turnPalette] [F:backend.activity.turn_palettes.PRODUCT_TOOLS] [F:backend.activity.turn_palettes.SECTOR_TOOLS] [F:backend.activity.turn_palettes.RESEARCH_TOOLS]', () => {
  it('Karbot sees every new tool', () => {
    for (const name of [...NEW_OPS, 'db.request_plan']) expect(PRODUCT_TOOLS.has(name), name).toBe(true)
    expect(turnPalette({})).toEqual(expect.arrayContaining(NEW_OPS))
  })

  it('sector chats see only their four ops tools', () => {
    for (const name of SECTOR_OPS) expect(SECTOR_TOOLS.has(name), name).toBe(true)
    for (const name of NEW_OPS.filter((tool) => !SECTOR_OPS.includes(tool))) expect(SECTOR_TOOLS.has(name), name).toBe(false)
    expect(turnPalette({ sectorScoped: true })).toEqual(expect.arrayContaining(SECTOR_OPS))
  })

  it('research inherits the sector ops tools plus the plan writer', () => {
    for (const name of SECTOR_OPS) expect(RESEARCH_TOOLS.has(name), name).toBe(true)
    expect(RESEARCH_TOOLS.has('db.update_sector_plan')).toBe(true)
    expect(turnPalette({ sectorScoped: true, researchParent: true })).toEqual(expect.arrayContaining([...SECTOR_OPS, 'db.update_sector_plan']))
  })
})

describe('palette read-only passthrough [F:backend.activity.turn_palettes.productMcpClient] [F:backend.activity.turn_palettes.sectorMcpClient] [F:backend.activity.turn_palettes.researchMcpClient] [F:backend.activity.turn_palettes.freezeOriginalPalette]', () => {
  const stub = (isReadOnlyTool?: (name: string) => boolean): TurnRunnerMcpClient => ({
    authorityId: 'TEST',
    listTools: async () => [],
    callTool: async () => ({ content: 'TEST' }),
    ...(isReadOnlyTool === undefined ? {} : { isReadOnlyTool }),
  })
  const readOnly = (name: string): boolean => name === 'db.list_sessions'
  it('product preserves read-only knowledge', () => {
    const wrapped = productMcpClient(stub(readOnly))
    expect(wrapped.isReadOnlyTool?.('db.list_sessions')).toBe(true)
    expect(wrapped.isReadOnlyTool?.('db.other')).toBe(false)
  })
  it('sector preserves read-only knowledge', () => {
    const wrapped = sectorMcpClient(stub(readOnly))
    expect(wrapped.isReadOnlyTool?.('db.list_sessions')).toBe(true)
    expect(wrapped.isReadOnlyTool?.('db.other')).toBe(false)
  })
  it('research preserves read-only knowledge', () => {
    const wrapped = researchMcpClient(stub(readOnly))
    expect(wrapped.isReadOnlyTool?.('db.list_sessions')).toBe(true)
    expect(wrapped.isReadOnlyTool?.('db.other')).toBe(false)
  })
  it('freeze preserves read-only knowledge', () => {
    const wrapped = freezeOriginalPalette(stub(readOnly), ['db.list_sessions'])
    expect(wrapped.isReadOnlyTool?.('db.list_sessions')).toBe(true)
    expect(wrapped.isReadOnlyTool?.('db.other')).toBe(false)
  })
  it('omits the hook when the inner client lacks it', () => {
    expect(productMcpClient(stub()).isReadOnlyTool).toBeUndefined()
    expect(sectorMcpClient(stub()).isReadOnlyTool).toBeUndefined()
    expect(researchMcpClient(stub()).isReadOnlyTool).toBeUndefined()
    expect(freezeOriginalPalette(stub(), []).isReadOnlyTool).toBeUndefined()
  })
})
