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

const CONCURRENCY: Record<Lane, { workflows: number; activities: number }> = {
  turn: { workflows: 50, activities: 50 },
  tool: { workflows: 20, activities: 100 },
  research: { workflows: 10, activities: 20 },
  sweep: { workflows: 5, activities: 10 },
}

export function laneConfig(lane: Lane): LaneConfig {
  return {
    lane,
    taskQueue: `kardata-${lane}-v1`,
    maxConcurrentWorkflowTaskExecutions: CONCURRENCY[lane].workflows,
    maxConcurrentActivityTaskExecutions: CONCURRENCY[lane].activities,
  }
}

export function allLaneConfigs(): LaneConfig[] {
  return LANES.map(laneConfig)
}
