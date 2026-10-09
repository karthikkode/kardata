// Karbot monitor tick activities: claim the overlap guard, snapshot the
// target's health plus recent alerts, and post brief + snapshot into
// the Karbot session as a normal message (which runs a visible turn).
import { createLogger, logOp } from '../../observability/logging.js'
import { activityLogContext } from '../../observability/temporal-tracing.js'
import type { Scope } from '../../auth/types.js'
import {
  claimMonitorTick,
  finishMonitor,
  getMonitor,
  listSupervisionAlerts,
  releaseMonitorTick,
  researchHealth,
  threadHealth,
  threadTurnBusy,
  workerPoolFromEnv,
} from '../../db/index.js'
import { connectClient } from '../connection.js'
import { TemporalRunsGateway } from '../runs-gateway.js'

/** Alerts a sector snapshot may report: its own sector only. A bare
 * current-warning from another sector must never leak in. */
export function relevantAlerts<T extends { sectorId: string | null; state: string }>(items: T[], sectorId: string): T[] {
  return items.filter((item) => item.sectorId === sectorId).slice(0, 5)
}

async function sectorSnapshot(pool: Parameters<typeof researchHealth>[0], sectorId: string, scope: Scope): Promise<string> {
  const health = await researchHealth(pool, sectorId, scope)
  const lines = [`sector ${health.sector.name}: ${health.sector.state}, ${health.liveThreads} live threads${health.stale ? ' (STALE)' : ''}`]
  const page = await listSupervisionAlerts(pool, scope, Number.MAX_SAFE_INTEGER, 5)
  const relevant = relevantAlerts(page.items, sectorId)
  for (const item of relevant) lines.push(`alert [${item.severity}] ${item.subject}`)
  if (health.recentSupervision.length > 0) lines.push(`supervision: ${health.recentSupervision[0]?.kind} ${health.recentSupervision[0]?.response}`)
  return lines.join('\n')
}

async function threadSnapshot(pool: Parameters<typeof threadHealth>[0], threadKey: string, scope: Scope): Promise<string> {
  const health = await threadHealth(pool, threadKey, scope)
  const lines = [`thread ${threadKey}: ${health.status}, queue ${health.queueDepth}${health.stalled ? ' (STALLED)' : ''}`]
  if (health.lastRound) lines.push(`last round ${health.lastRound.round}: ${health.lastRound.model} ${health.lastRound.outcome}${health.lastRound.errorCode ? ` (${health.lastRound.errorCode})` : ''}`)
  return lines.join('\n')
}

export async function monitorTickActivity(input: { monitorId: string }): Promise<{ ticked: boolean; skipped?: string }> {
  const logger = createLogger(activityLogContext())
  return logOp(logger, 'monitor.tick', async () => {
    const pool = workerPoolFromEnv()
    // send() returns at enqueue, so the tick guard alone cannot stop
    // monitor messages piling onto a running Karbot turn: claim only
    // when the Karbot thread is idle, else skip for this interval.
    const current = await getMonitor(pool, input.monitorId)
    if (!current || current.stoppedAt) return { ticked: false, skipped: 'stopped' }
    if (await threadTurnBusy(pool, current.karbotThreadKey)) return { ticked: false, skipped: 'busy' }
    const claimed = await claimMonitorTick(pool, input.monitorId)
    if (!claimed) {
      const recheck = await getMonitor(pool, input.monitorId)
      return { ticked: false, skipped: !recheck || recheck.stoppedAt ? 'stopped' : 'overlap' }
    }
    try {
      const scope = { tenantId: claimed.tenantId, projectId: claimed.projectId }
      const snapshot = claimed.targetSectorId
        ? await sectorSnapshot(pool, claimed.targetSectorId, scope)
        : await threadSnapshot(pool, claimed.targetThreadKey as string, scope)
      // The gateway never closes a self-made connection, so each tick
      // leaked one: own the connection here and close it in finally.
      const connection = await connectClient()
      try {
        await new TemporalRunsGateway(pool, connection).send(claimed.karbotThreadKey, `[Monitor ${claimed.id}] ${claimed.brief}\n${snapshot}`)
      } finally {
        await connection.close()
      }
      return { ticked: true }
    } finally {
      await releaseMonitorTick(pool, input.monitorId)
    }
  }, { monitorId: input.monitorId })
}

export async function finishMonitorActivity(input: { monitorId: string }): Promise<{ finished: boolean }> {
  const logger = createLogger(activityLogContext())
  return logOp(logger, 'monitor.finish', async () => {
    await finishMonitor(workerPoolFromEnv(), input.monitorId)
    return { finished: true }
  }, { monitorId: input.monitorId })
}
