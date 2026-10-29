import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, records, recordTypes, researchRuns, sectorCompanies, sectors, sources } from "../../src/db/schema.js";
import {
  companyContacts,
  isContactable,
  recordApolloContacts,
  rederivePublicContacts,
  rederiveSectorPublicContacts,
} from "../../src/domain/contacts.js";
import { recordVerdicts, sectorTierSummary } from "../../src/domain/tiering.js";
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

async function seedCompany(domain: string): Promise<{ companyId: string; sourceId: string }> {
  const db = handle.db;
  const companyId = randomUUID();
  const runId = randomUUID();
  const sourceId = randomUUID();
  await db.insert(companies).values({ id: companyId, source: "manual", name: domain, domain });
  await db.insert(researchRuns).values({ id: runId, companyId, kind: "collect", status: "succeeded" });
  await db.insert(sources).values({
    id: sourceId,
    companyId,
    runId,
    url: `https://${domain}/`,
    finalUrl: `https://${domain}/`,
    collector: "test",
    status: "ok",
    fetchedAt: new Date(),
  });
  await db
    .insert(recordTypes)
    .values({ name: "leader", description: "leader", fields: [], naturalKey: ["name"], createdBy: "test" })
    .onConflictDoNothing();
  return { companyId, sourceId };
}

async function seedLeader(
  companyId: string,
  sourceId: string,
  data: Record<string, unknown>,
  verification: "verified" | "quote_mismatch" = "verified",
): Promise<void> {
  await handle.db.insert(records).values({
    id: randomUUID(),
    companyId,
    type: "leader",
    naturalKeyHash: randomUUID(),
    data,
    sourceIds: [sourceId],
    verification,
    quote: "q",
    createdBy: "extractor:hiring",
  });
}

describe("contact statuses (D-67)", () => {
  it("derives public name and role rows from grounded leader records only", async () => {
    const { companyId, sourceId } = await seedCompany("leaf.example");
    await seedLeader(companyId, sourceId, { name: "Synthetic Founder", role: "Founder" });
    await seedLeader(companyId, sourceId, { role: "Head of Operations" });
    await seedLeader(companyId, sourceId, { name: "Mismatched Person", role: "CEO" }, "quote_mismatch");

    expect(await rederivePublicContacts(handle.db, companyId)).toEqual({
      name_verified_public: 1,
      role_verified_public: 2,
    });
    const view = await companyContacts(handle.db, companyId);
    expect(view.statuses.map((r) => [r.status, r.people])).toEqual([
      ["name_verified_public", 1],
      ["role_verified_public", 2],
    ]);
    // Public names and roles never make a company contactable.
    expect(view.contactable).toBe(false);
  });

  it("records Apollo statuses by domain, replaces them as a set and keeps public rows", async () => {
    const { companyId, sourceId } = await seedCompany("leaf.example");
    await seedLeader(companyId, sourceId, { name: "Synthetic Founder", role: "Founder" });
    await rederivePublicContacts(handle.db, companyId);

    const [first] = await recordApolloContacts(handle.db, [
      {
        domain: "https://www.leaf.example/",
        counts: { name_verified_apollo: 2, role_verified_apollo: 2, email_verified_apollo: 1 },
        source: "apollo export 2026-11-01",
      },
    ]);
    expect(first).toMatchObject({ ok: true, companyId, contactable: true });

    const [second] = await recordApolloContacts(handle.db, [
      { companyId, counts: { name_verified_apollo: 1, phone_verified_apollo: 1 }, source: "apollo export 2026-11-08" },
    ]);
    expect(second).toMatchObject({ ok: true, contactable: false });

    const view = await companyContacts(handle.db, companyId);
    expect(view.statuses.map((r) => r.status)).toEqual([
      "name_verified_public",
      "role_verified_public",
      "name_verified_apollo",
      "phone_verified_apollo",
    ]);
    expect(view.contactable).toBe(false);
  });

  it("fails one item without blocking the others", async () => {
    const { companyId } = await seedCompany("leaf.example");
    const results = await recordApolloContacts(handle.db, [
      { domain: "missing.example", counts: { email_verified_apollo: 1 }, source: "apollo" },
      { companyId, domain: "leaf.example", counts: { email_verified_apollo: 1 }, source: "apollo" },
      { companyId, counts: { email_verified_apollo: 1 }, source: "apollo" },
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
    expect(isContactable((await companyContacts(handle.db, companyId)).statuses.map((r) => r.status))).toBe(true);
  });

  it("counts contact statuses and contactable companies in the sector summary", async () => {
    const sectorId = randomUUID();
    await handle.db.insert(sectors).values({ id: sectorId, name: `sector-${sectorId.slice(0, 6)}` });
    const a = await seedCompany("a.example");
    const b = await seedCompany("b.example");
    for (const c of [a, b]) {
      await handle.db.insert(sectorCompanies).values({ sectorId, companyId: c.companyId, addedVia: "manual" });
    }
    await seedLeader(a.companyId, a.sourceId, { name: "Synthetic Founder", role: "Founder" });
    await recordVerdicts(handle.db, [
      { companyId: a.companyId, sectorId, score: 2, signals: {}, status: "icp_accepted", source: "test" },
      { companyId: b.companyId, sectorId, score: 0, signals: {}, status: "icp_watchlist", source: "test" },
    ]);
    expect(await rederiveSectorPublicContacts(handle.db, sectorId)).toEqual({ companies: 2, withName: 1, withRole: 1 });
    await recordApolloContacts(handle.db, [
      { companyId: b.companyId, counts: { email_verified_apollo: 1 }, source: "apollo" },
    ]);

    const summary = await sectorTierSummary(handle.db, sectorId);
    expect(summary.byContactStatus).toEqual({
      name_verified_public: 1,
      role_verified_public: 1,
      email_verified_apollo: 1,
    });
    expect(summary.contactable).toBe(1);
    expect(summary.byIcpStatus).toEqual({ icp_accepted: 1, icp_watchlist: 1 });
  });
});
