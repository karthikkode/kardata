import { describe, expect, it } from 'vitest'
import { PRODUCT_TOOLS, RESEARCH_TOOLS, SECTOR_TOOLS, turnPalette } from '../../backend/src/temporal/activities/turn-palettes.js'

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
