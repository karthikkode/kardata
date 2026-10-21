import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { researchRuns } from "../db/schema.js";
import { executeCollectRun } from "../collect/run.js";

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_POLL_MS = 1000;
export const STALL_AFTER_MS = 10 * 60 * 1000;

export function collectConcurrency(): number {
  const raw = process.env.COLLECT_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_CONCURRENCY;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CONCURRENCY;
}

export interface RunnerClock {
  now: () => Date;
}

export interface RunnerOpts {
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
  const concurrency = opts.concurrency ?? collectConcurrency();
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const clock = opts.clock ?? { now: () => new Date() };
  const execute = opts.execute ?? ((runId: string) => executeCollectRun(db, runId));
  const active = new Set<string>();
  let peak = 0;
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  // Crash recovery: runs caught mid-flight by a restart fail loudly, except
  // worker-driven extraction subjobs, which the company worker reruns.
  async function recover(): Promise<void> {
    await db
      .update(researchRuns)
      .set({ status: "failed", error: "server restarted", finishedAt: new Date() })
      .where(
        and(
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
      .where(and(eq(researchRuns.status, "running"), lt(researchRuns.lastActivityAt, cutoff)))
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
      while (active.size < concurrency) {
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
