import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { areaStatuses, companies, findings, researchRuns } from "../../src/db/schema.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

beforeEach(async () => {
  await resetTestDb(handle);
});

afterAll(async () => {
  await handle.close();
});

async function makeCompany(): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name: "Constraint Co" })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeRun(companyId: string, status: "queued" | "running" = "queued"): Promise<string> {
  const [row] = await handle.db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "collect", status })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("no run row");
  return row.id;
}

describe("research schema constraints", () => {
  it("rejects a second active run for the same company", async () => {
    const companyId = await makeCompany();
    await makeRun(companyId, "queued");
    await expect(makeRun(companyId, "running")).rejects.toThrow();
    await expect(makeRun(companyId, "queued")).rejects.toThrow();
    const other = await makeCompany();
    await expect(makeRun(other, "running")).resolves.toBeTruthy();
    await handle.db
      .update(researchRuns)
      .set({ status: "succeeded" })
      .where(eq(researchRuns.companyId, companyId));
    await expect(makeRun(companyId, "queued")).resolves.toBeTruthy();
  });

  it("rejects a finding with no source ids", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    await expect(
      handle.db.insert(findings).values({
        id: randomUUID(),
        companyId,
        runId,
        area: "reviews",
        claim: "unsourced",
        sourceIds: [],
        confidence: "low",
        status: "unverified",
        createdBy: "test",
      }),
    ).rejects.toThrow();
    await expect(
      handle.db
        .insert(findings)
        .values({
          id: randomUUID(),
          companyId,
          runId,
          area: "reviews",
          claim: "sourced",
          sourceIds: [randomUUID()],
          confidence: "low",
          status: "unverified",
          createdBy: "test",
        })
        .returning({ id: findings.id }),
    ).resolves.toHaveLength(1);
  });

  it("rejects a non-done area status without a reason", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    await expect(
      handle.db.insert(areaStatuses).values({
        runId,
        area: "reviews",
        companyId,
        status: "not_found",
        reason: null,
      }),
    ).rejects.toThrow();
    await expect(
      handle.db
        .insert(areaStatuses)
        .values({
          runId,
          area: "hiring",
          companyId,
          status: "not_found",
          reason: "no careers page",
        })
        .returning(),
    ).resolves.toHaveLength(1);
    await expect(
      handle.db
        .insert(areaStatuses)
        .values({ runId, area: "product", companyId, status: "done", reason: null })
        .returning(),
    ).resolves.toHaveLength(1);
  });
});
