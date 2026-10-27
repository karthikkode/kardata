import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, researchRuns } from "../../src/db/schema.js";
import { hasFreshCollect, researchStart } from "../../src/runs/agent.js";
import { latestPromptVersion } from "../../src/runs/prompt.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;

async function makeCompany(name: string): Promise<string> {
  const id = randomUUID();
  await handle.db.insert(companies).values({ id, source: "manual", name });
  return id;
}

async function makeCollectRun(
  companyId: string,
  status: "succeeded" | "partial" | "failed",
  finishedDaysAgo: number,
): Promise<void> {
  await handle.db.insert(researchRuns).values({
    id: randomUUID(),
    companyId,
    kind: "collect",
    status,
    createdBy: "owner",
    startedAt: new Date(Date.now() - (finishedDaysAgo * 24 + 1) * 60 * 60 * 1000),
    finishedAt: new Date(Date.now() - finishedDaysAgo * 24 * 60 * 60 * 1000),
  });
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

beforeEach(async () => {
  await resetTestDb(handle);
});

describe("researchStart", () => {
  it("validates its input", async () => {
    const a = await makeCompany("A Co");
    await expect(researchStart(handle.db, { companyIds: [] })).rejects.toThrow(/at least one/);
    await expect(
      researchStart(handle.db, { companyIds: Array.from({ length: 101 }, () => randomUUID()) }),
    ).rejects.toThrow(/at most 100/);
    await expect(researchStart(handle.db, { companyIds: [randomUUID()] })).rejects.toThrow(
      /unknown companies/,
    );
    await expect(researchStart(handle.db, { companyIds: [a], areas: ["nope"] })).rejects.toThrow(
      /unknown area/,
    );
    await expect(researchStart(handle.db, { companyIds: [a], maxMinutes: 0 })).rejects.toThrow(
      /maxMinutes/,
    );
    await expect(researchStart(handle.db, { companyIds: [a], maxModelSteps: 1.5 })).rejects.toThrow(
      /maxModelSteps/,
    );
    await expect(
      researchStart(handle.db, { companyIds: [a], recollectIfOlderThanDays: -1 }),
    ).rejects.toThrow(/recollectIfOlderThanDays/);
    await expect(researchStart(handle.db, { companyIds: [a], brief: "x".repeat(2049) })).rejects.toThrow(
      /brief/,
    );
  });

  it("creates one queued agent run per company with the options stored", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const result = await researchStart(handle.db, {
      companyIds: [a, b, a],
      areas: ["hiring"],
      maxMinutes: 10,
      maxModelSteps: 25,
      brief: "owner note",
    });
    expect(result.batchId).toBeTruthy();
    expect(result.runs).toHaveLength(2);
    expect(result.runs.map((r) => r.status)).toEqual(["queued", "queued"]);
    const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.companyId, a));
    expect(run?.kind).toBe("agent");
    expect(run?.status).toBe("queued");
    expect(run?.batchId).toBe(result.batchId);
    expect(run?.agentOptions).toEqual({
      recollectDays: 14,
      maxMinutes: 10,
      maxModelSteps: 25,
      brief: "owner note",
    });
  });

  it("stores the prompt version, defaulting to latest", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    await researchStart(handle.db, { companyIds: [a] });
    await researchStart(handle.db, { companyIds: [b], promptVersion: "v1" });
    const [runA] = await handle.db.select().from(researchRuns).where(eq(researchRuns.companyId, a));
    const [runB] = await handle.db.select().from(researchRuns).where(eq(researchRuns.companyId, b));
    expect(runA?.promptVersion).toBe(latestPromptVersion());
    expect(runB?.promptVersion).toBe("v1");
    await expect(researchStart(handle.db, { companyIds: [a], promptVersion: "v9" })).rejects.toThrow(
      /unknown prompt version/,
    );
  });

  it("reports already_running for companies with an active run", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const first = await researchStart(handle.db, { companyIds: [a] });
    const firstId = (first.runs[0] as { runId: string }).runId;
    await handle.db.insert(researchRuns).values({
      id: randomUUID(),
      companyId: b,
      kind: "collect",
      status: "running",
      createdBy: "owner",
      startedAt: new Date(),
    });
    const second = await researchStart(handle.db, { companyIds: [a, b] });
    expect(second.runs).toEqual([
      { companyId: a, runId: firstId, status: "already_running" },
      expect.objectContaining({ companyId: b, status: "already_running" }),
    ]);
  });
});

describe("hasFreshCollect", () => {
  it("counts recent successful collects only", async () => {
    const a = await makeCompany("A Co");
    expect(await hasFreshCollect(handle.db, a, 14)).toBe(false);
    await makeCollectRun(a, "failed", 1);
    expect(await hasFreshCollect(handle.db, a, 14)).toBe(false);
    await makeCollectRun(a, "succeeded", 20);
    expect(await hasFreshCollect(handle.db, a, 14)).toBe(false);
    await makeCollectRun(a, "partial", 2);
    expect(await hasFreshCollect(handle.db, a, 14)).toBe(true);
  });
});
