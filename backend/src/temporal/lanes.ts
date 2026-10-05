// Task-queue lane topology. B2.1. One lane per workload class so a hot
// lane cannot starve the rest. Queue names are versioned (v1); incompatible
// workflow changes move to v2, never in-place. Concurrency values are
// starting points; B5.6 tunes them from soak numbers.
export const LANES = ['turn', 'tool', 'research', 'sweep'] as const

export type Lane = (typeof LANES)[number]

export interface LaneConfig {
  lane: Lane
  taskQueue: string
  maxConcurrentWorkflowTaskExecutions: number
  maxConcurrentActivityTaskExecutions: number
}

/** Turn activity slots per worker. Default 4; invalid values fail fast at
 * worker startup so a typo never silently paces (or storms) the vendor. */
export function turnActivitySlots(): number {
  const raw = process.env['KARDATA_TURN_ACTIVITY_SLOTS']
  if (raw === undefined || raw === '') return 4
  const slots = Number(raw)
  if (!Number.isInteger(slots) || slots < 1) throw new Error(`KARDATA_TURN_ACTIVITY_SLOTS must be a positive integer, got ${JSON.stringify(raw)}`)
  return slots
}

const CONCURRENCY: Record<Lane, { workflows: number; activities: number }> = {
  // Vendor pacing: at most 4 concurrent turn activities per worker. The
  // pilot proved a 20-way concurrent research-turn fan-out saturates the
  // live provider into mass provider_failed while 2-way succeeds; the cap
  // keeps provider concurrency storm-safe while queued turns wait inside
  // their (now generous) schedule-to-close windows. Workflow tasks stay
  // wide — orchestration is cheap, vendor calls are not. Raise only with
  // measured provider headroom, never by vibes.
  turn: { workflows: 50, activities: 4 },
  tool: { workflows: 20, activities: 100 },
  research: { workflows: 10, activities: 20 },
  sweep: { workflows: 5, activities: 10 },
}

export function laneConfig(lane: Lane): LaneConfig {
  return {
    lane,
    taskQueue: `kardata-${lane}-v1`,
    maxConcurrentWorkflowTaskExecutions: CONCURRENCY[lane].workflows,
    maxConcurrentActivityTaskExecutions: lane === 'turn' ? turnActivitySlots() : CONCURRENCY[lane].activities,
  }
}

export function allLaneConfigs(): LaneConfig[] {
  return LANES.map(laneConfig)
}
