import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { researchRuns } from "../db/schema.js";
import { executeCollectRun } from "../collect/run.js";
import { effectiveCollectLimit } from "./settings.js";

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_POLL_MS = 1000;
export const STALL_AFTER_MS = 10 * 60 * 1000;

export interface RunnerClock {
  now: () => Date;
}

export interface RunnerOpts {
  /** Fixed width (tests). Production follows the live DB knob every tick. */
  concurrency?: number;
  pollMs?: number;
  clock?: RunnerClock;
  // Injected for tests; production runs the real collectors.
  execute?: (runId: string) => Promise<unknown>;
}

export interface Runner {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  tick: () => Promise<void>;
  recover: () => Promise<void>;
  reapStalled: (now?: Date) => Promise<number>;
  activeCount: () => number;
  maxActive: () => number;
}

export function createRunner(db: Db, opts: RunnerOpts = {}): Runner {
  const fixed = opts.concurrency;
  let limit = fixed ?? DEFAULT_CONCURRENCY;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const clock = opts.clock ?? { now: () => new Date() };
  const execute = opts.execute ?? ((runId: string) => executeCollectRun(db, runId));
  const active = new Set<string>();
  let peak = 0;
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  // Crash recovery: collect runs caught mid-flight by a restart fail loudly,
  // except worker-driven extraction subjobs, which the company worker reruns.
  // Agent rows are never touched here: the agent runner owns their liveness,
  // and at startup it claims rows before this recover runs (cross-killing
  // them failed "server restarted", which the agent tick then finalized as
  // cancelled — killing live containers).
  async function recover(): Promise<void> {
    await db
      .update(researchRuns)
      .set({ status: "failed", error: "server restarted", finishedAt: new Date() })
      .where(
        and(
          eq(researchRuns.kind, "collect"),
          eq(researchRuns.status, "running"),
          or(isNull(researchRuns.stage), ne(researchRuns.stage, "extraction")),
        ),
      );
  }

  async function reapStalled(now: Date = clock.now()): Promise<number> {
    const cutoff = new Date(now.getTime() - STALL_AFTER_MS);
    const rows = await db
      .update(researchRuns)
      .set({ status: "stalled", finishedAt: new Date() })
      .where(
        and(
          eq(researchRuns.kind, "collect"),
          eq(researchRuns.status, "running"),
          lt(researchRuns.lastActivityAt, cutoff),
        ),
      )
      .returning({ id: researchRuns.id });
    return rows.length;
  }

  async function claimOne(): Promise<string | null> {
    // Single in-process runner with a tick guard: no concurrent claims.
    const [row] = await db
      .update(researchRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(
        and(
          eq(researchRuns.status, "queued"),
          sql`${researchRuns.id} = (SELECT id FROM research_runs WHERE status = 'queued' AND kind = 'collect' ORDER BY created_at ASC LIMIT 1)`,
        ),
      )
      .returning({ id: researchRuns.id });
    return row?.id ?? null;
  }

  function launch(runId: string): void {
    active.add(runId);
    peak = Math.max(peak, active.size);
    void execute(runId)
      .catch(() => {
        // executeCollectRun records its own failures; injected fakes may throw.
      })
      .finally(() => {
        active.delete(runId);
      });
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      await reapStalled();
      // The DB knob (collect_concurrency_set) takes effect on the next
      // tick — no restart. Wide open while the quota breaker is tripped.
      limit = await effectiveCollectLimit(db, fixed);
      while (active.size < limit) {
        const claimed = await claimOne();
        if (!claimed) break;
        launch(claimed);
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start: async () => {
      await recover();
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, pollMs);
      timer.unref();
      await tick();
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      while (active.size > 0) {
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    tick,
    recover,
    reapStalled: (now?: Date) => reapStalled(now ?? clock.now()),
    activeCount: () => active.size,
    maxActive: () => peak,
  };
}
