// Queued-child controls (C6/2): pause, resume, cancel and steer reach a
// QUEUED child through its live parent; a child that promoted between the
// read and the control keeps the running path. The Temporal client is
// mocked (see subagent-pause.test.ts); the workflow-level drain and
// promotion proof lives in workflows.queued-controls.test.ts.
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { WorkflowNotFoundError, type Connection } from '@temporalio/client'
import { appendEvent, getThread, isThreadPaused, type TransactableDb } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { delegationWorkflowId } from '../../backend/src/temporal/runs-helpers.js'
import { RunNotFound, ThreadNotAccepting } from '../../backend/src/temporal/runs-types.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const fixture = vi.hoisted(() => ({ describe: vi.fn(), signal: vi.fn(), query: vi.fn() }))
vi.mock('@temporalio/client', async (original) => {
  const actual = await original<typeof import('@temporalio/client')>()
  return {
    ...actual,
    Client: class {
      workflow = {
        getHandle: (id: string) => ({
          describe: () => fixture.describe(id),
          signal: (...args: unknown[]) => fixture.signal(id, ...args),
          query: (...args: unknown[]) => fixture.query(id, ...args),
        }),
      }
    },
  }
})
afterEach(() => vi.resetAllMocks())

describe.skipIf(!TEST_DATABASE_URL)(
  'queued child controls (C6/2) [F:db.threads.getThread] [F:db.workspace_threads.enqueueQueuedSteering] [F:db.workspace_threads.setThreadPaused] [F:db.workspace_threads.isThreadPaused]',
  () => {
    let pool: Pool
    let gateway: TemporalRunsGateway

    beforeAll(async () => {
      pool = new Pool({ connectionString: await ensureTestDb('kardata_test_queued'), max: 5 })
      gateway = new TemporalRunsGateway(pool as TransactableDb, {} as Connection)
    })
    afterAll(async () => {
      await pool?.end()
    })

    async function seedQueued(sessionId: string, childId: string): Promise<void> {
      await appendEvent(pool, {
        idempotencyKey: `TEST-q-created-${childId}`,
        partition: `session:${sessionId}`,
        type: 't.session.created',
        payload: { sessionId, title: 'queued controls' },
      })
      await appendEvent(pool, {
        idempotencyKey: `TEST-q-queued-${childId}`,
        partition: `session:${sessionId}`,
        type: 't.subagent.queued',
        payload: { childId },
      })
      await projectNewEvents(pool)
    }

    async function waitForParentSignal(): Promise<void> {
      const deadline = Date.now() + 5000
      while (fixture.signal.mock.calls.length === 0) {
        if (Date.now() > deadline) throw new Error('timed out waiting for the parent signal')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }

    async function flipState(threadKey: string, status: string, acceptingSteer: boolean): Promise<void> {
      await appendEvent(pool, {
        idempotencyKey: `TEST-q-flip-${threadKey}-${status}-${Date.now()}`,
        partition: `child:${threadKey.slice('agent:'.length)}`,
        type: 't.thread.state',
        payload: { threadKey, status, acceptingSteer },
      })
      await projectNewEvents(pool)
    }

    it('pauses a queued child via its parent', async () => {
      const sessionId = 'TEST-q-pause-session'
      const childId = 'TEST-q-pause'
      await seedQueued(sessionId, childId)
      fixture.query.mockResolvedValue({ queued: [childId] })
      // The parent appends PAUSED asynchronously after the signal; the
      // flip lands once the gateway is polling for it.
      const pending = gateway.pauseRun(childId)
      await waitForParentSignal()
      await flipState(`agent:${childId}`, 'PAUSED', false)
      expect(await pending).toMatchObject({ state: 'accepted' })
      expect(fixture.signal).toHaveBeenCalledWith(delegationWorkflowId(sessionId), 'parentChildControl', {
        childId,
        action: 'pause',
      })
      expect(await isThreadPaused(pool, `agent:${childId}`)).toBe(true)
    })

    it('resumes a paused-queued child via its parent', async () => {
      const sessionId = 'TEST-q-resume-session'
      const childId = 'TEST-q-resume'
      await seedQueued(sessionId, childId)
      await flipState(`agent:${childId}`, 'PAUSED', false)
      fixture.query.mockResolvedValue({ queued: [childId] })
      const pending = gateway.resumeRun(childId)
      await waitForParentSignal()
      await flipState(`agent:${childId}`, 'QUEUED', true)
      expect(await pending).toMatchObject({ state: 'accepted' })
      expect(fixture.signal).toHaveBeenCalledWith(delegationWorkflowId(sessionId), 'parentChildControl', {
        childId,
        action: 'resume',
      })
      expect(await isThreadPaused(pool, `agent:${childId}`)).toBe(false)
    })

    it('cancels a queued child via its parent', async () => {
      const sessionId = 'TEST-q-cancel-session'
      const childId = 'TEST-q-cancel'
      await seedQueued(sessionId, childId)
      fixture.query.mockResolvedValue({ queued: [childId] })
      const pending = gateway.cancelRun(childId)
      await waitForParentSignal()
      await appendEvent(pool, {
        idempotencyKey: `TEST-q-cancelled-${childId}`,
        partition: `session:${sessionId}`,
        type: 't.subagent.completed',
        payload: { summary: { id: childId, status: 'cancelled' } },
      })
      await projectNewEvents(pool)
      expect(await pending).toMatchObject({ state: 'accepted' })
      expect(fixture.signal).toHaveBeenCalledWith(delegationWorkflowId(sessionId), 'parentChildControl', {
        childId,
        action: 'cancel',
      })
      expect((await getThread(pool, `agent:${childId}`))?.status).toBe('FINISHED')
    })

    it('steers a queued child as pending for its first turn', async () => {
      const sessionId = 'TEST-q-steer-session'
      const childId = 'TEST-q-steer'
      await seedQueued(sessionId, childId)
      const result = await gateway.steer(`agent:${childId}`, 'skip franchises')
      expect(result.state).toBe('accepted')
      const { rows } = await pool.query<{ state: string }>('SELECT state FROM thread_instructions WHERE thread_key=$1', [
        `agent:${childId}`,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0]?.state).toBe('pending')
    })

    it('keeps the running path for a child that promoted', async () => {
      const sessionId = 'TEST-q-promoted-session'
      const childId = 'TEST-q-promoted'
      await seedQueued(sessionId, childId)
      await flipState(`agent:${childId}`, 'RUNNING', true)
      fixture.describe.mockResolvedValue({ type: 'subagentRun', status: { name: 'RUNNING' } })
      await gateway.pauseRun(childId)
      expect(fixture.query).not.toHaveBeenCalled()
      expect(fixture.signal).toHaveBeenCalledWith(childId, 'childPause')
    })

    it('reports a stale queued row without a parent as a conflict', async () => {
      const sessionId = 'TEST-q-stale-session'
      const childId = 'TEST-q-stale'
      await seedQueued(sessionId, childId)
      fixture.query.mockRejectedValue(new WorkflowNotFoundError('parent gone', delegationWorkflowId(sessionId), undefined))
      await expect(gateway.pauseRun(childId)).rejects.toThrow(ThreadNotAccepting)
    })

    it('keeps the running path when the parent queue no longer holds the child', async () => {
      const sessionId = 'TEST-q-race-session'
      const childId = 'TEST-q-race'
      await seedQueued(sessionId, childId)
      fixture.query.mockResolvedValue({ queued: [] })
      fixture.describe.mockRejectedValue(new WorkflowNotFoundError('no handle', childId, undefined))
      await expect(gateway.pauseRun(childId)).rejects.toThrow(RunNotFound)
    })
  },
)
