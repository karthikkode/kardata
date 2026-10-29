import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, records, recordTypes, researchRuns, sectorCompanies, sectors, sources } from "../../src/db/schema.js";
import {
  companyContacts,
  isContactable,
  importApolloContacts,
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

  it("stores Apollo people, derives Apollo statuses and keeps paid fields across pulls", async () => {
    const { companyId, sourceId } = await seedCompany("leaf.example");
    await seedLeader(companyId, sourceId, { name: "Synthetic Founder", role: "Founder" });
    await rederivePublicContacts(handle.db, companyId);

    const pull = (source: string, contacts: Parameters<typeof importApolloContacts>[1]["contacts"]) =>
      importApolloContacts(handle.db, { source, pulledAt: new Date("2026-10-27"), contacts });
    const first = await pull("apollo pull 1", [
      { apolloId: "p1", domain: "https://www.leaf.example/", name: "Synthetic One", title: "Founder", email: "one@leaf.example", emailStatus: "verified" },
      { apolloId: "p2", domain: "leaf.example", name: "Synthetic Two", title: "COO", email: "two@leaf.example", emailStatus: "extrapolated" },
    ]);
    expect(first.map((r) => r.ok && r.outcome)).toEqual(["created", "created"]);
    let view = await companyContacts(handle.db, companyId);
    expect(view.statuses.map((r) => [r.status, r.people])).toEqual([
      ["name_verified_public", 1],
      ["role_verified_public", 1],
      ["name_verified_apollo", 2],
      ["role_verified_apollo", 2],
      // An extrapolated email is not verified.
      ["email_verified_apollo", 1],
    ]);
    expect(view.contactable).toBe(true);

    // A later mobile-only pull adds the phone and keeps the email we paid for.
    const second = await pull("apollo pull 2", [{ apolloId: "p1", companyId, mobile: "+10000000000" }]);
    expect(second[0]).toMatchObject({ ok: true, outcome: "updated" });
    view = await companyContacts(handle.db, companyId);
    expect(view.statuses.map((r) => r.status)).toContain("phone_verified_apollo");
    expect(view.apollo.find((p) => p.apolloId === "p1")).toMatchObject({
      email: "one@leaf.example",
      emailStatus: "verified",
      mobile: "+10000000000",
      source: "apollo pull 2",
    });
    expect(view.contactable).toBe(true);
  });

  it("fails one person without blocking the others", async () => {
    const { companyId } = await seedCompany("leaf.example");
    const results = await importApolloContacts(handle.db, {
      source: "apollo",
      pulledAt: new Date(),
      contacts: [
        { apolloId: "x1", domain: "missing.example", email: "a@missing.example", emailStatus: "verified" },
        { apolloId: "x2", companyId, domain: "leaf.example", email: "b@leaf.example", emailStatus: "verified" },
        { apolloId: "x3", companyId, email: "c@leaf.example", emailStatus: "verified" },
      ],
    });
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
    expect(isContactable((await companyContacts(handle.db, companyId)).statuses.map((r) => r.status))).toBe(true);
  });

  it("counts contact statuses and contactable companies in the sector summary", async () => {
    const sectorId = randomUUID();
    await handle.db.insert(sectors).values({ id: sectorId, name: `sector-${sectorId.slice(0, 6)}` });
    const a = await seedCompany("a.example");
    const b = await seedCompany("b.example");
    for (const c of [a, b]) {
      await handle.db
        .insert(sectorCompanies)
        .values({ sectorId, companyId: c.companyId, addedVia: "manual", eligibility: "eligible" });
    }
    // An imported member that preflight rejected is not a sector company and is never counted.
    const out = await seedCompany("out.example");
    await handle.db
      .insert(sectorCompanies)
      .values({ sectorId, companyId: out.companyId, addedVia: "manual", eligibility: "ineligible" });
    await seedLeader(out.companyId, out.sourceId, { name: "Synthetic Outsider", role: "CEO" });
    await seedLeader(a.companyId, a.sourceId, { name: "Synthetic Founder", role: "Founder" });
    await recordVerdicts(handle.db, [
      { companyId: a.companyId, sectorId, score: 2, signals: {}, status: "icp_accepted", source: "test" },
      { companyId: b.companyId, sectorId, score: 0, signals: {}, status: "icp_watchlist", source: "test" },
      { companyId: out.companyId, sectorId, score: 3, signals: {}, status: "icp_accepted", source: "test" },
    ]);
    expect(await rederiveSectorPublicContacts(handle.db, sectorId)).toEqual({ companies: 2, withName: 1, withRole: 1 });
    await importApolloContacts(handle.db, {
      source: "apollo",
      pulledAt: new Date(),
      contacts: [{ apolloId: "b1", companyId: b.companyId, email: "b@b.example", emailStatus: "verified" }],
    });

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
