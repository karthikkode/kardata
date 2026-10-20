import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  areaStatuses,
  companies,
  documents,
  factKeys,
  facts,
  factsCurrent,
  findings,
  records,
  recordTypes,
  researchRuns,
  sources,
} from "../../src/db/schema.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import {
  approveRegistryEntry,
  listRegistry,
  registerFactKey,
  registerRecordType,
} from "../../src/domain/research/registry.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { addFinding } from "../../src/domain/research/findings.js";
import { setAreaStatus } from "../../src/domain/research/status.js";
import { DomainError } from "../../src/domain/errors.js";
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

async function makeCompany(name = "Model Co"): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeRun(companyId: string, status: "running" | "succeeded" = "running"): Promise<string> {
  const [row] = await handle.db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "collect", status })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("no run row");
  return row.id;
}

async function makeSource(companyId: string, runId: string, url = "http://example.invalid/"): Promise<string> {
  const [row] = await handle.db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId,
      runId,
      url,
      finalUrl: url,
      collector: "test",
      status: "ok",
      httpStatus: 200,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("no source row");
  return row.id;
}

function err(results: { ok: boolean; error?: string }[], index: number): string {
  const r = results[index] as { ok: boolean; error?: string };
  expect(r.ok).toBe(false);
  return r.error ?? "";
}

describe("seed registry", () => {
  it("holds 29 approved fact keys and 11 approved record types", async () => {
    const keys = await handle.db.select().from(factKeys).where(eq(factKeys.createdBy, "seed"));
    const types = await handle.db.select().from(recordTypes).where(eq(recordTypes.createdBy, "seed"));
    expect(keys).toHaveLength(29);
    expect(types).toHaveLength(11);
    expect(keys.every((k) => k.status === "approved")).toBe(true);
    expect(types.every((t) => t.status === "approved")).toBe(true);
    expect(keys.map((k) => k.key)).toContain("reviews.avg_rating");
    expect(types.map((t) => t.name)).toContain("job_posting");
  });

  it("listRegistry filters by area but keeps general keys", async () => {
    const { factKeys: keys } = await listRegistry(handle.db, "reviews");
    const names = keys.map((k) => k.key);
    expect(names).toContain("reviews.avg_rating");
    expect(names).toContain("company.founded_year");
    expect(names).not.toContain("product.count");
  });
});

describe("facts", () => {
  it("validates every value type into its typed column", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    await registerFactKey(
      handle.db,
      { key: "test.site_url", valueType: "url", description: "test url" },
      "owner",
    );
    await registerFactKey(
      handle.db,
      { key: "test.tags", valueType: "text_list", description: "test list" },
      "owner",
    );
    const base = { sourceIds: [sourceId], confidence: "high" };
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      facts: [
        { key: "product.count", value: 42, ...base },
        { key: "product.price_min", value: { amount: 19.5, currency: "usd" }, ...base },
        { key: "product.catalog_change_12m", value: 12.5, ...base },
        { key: "financials.last_raise_date", value: "2025-06-01", ...base },
        { key: "marketing.channel_active", value: true, qualifiers: { channel: "meta" }, ...base },
        { key: "reviews.app", value: "Judge.me", ...base },
        { key: "test.site_url", value: "https://example.invalid/", ...base },
        { key: "test.tags", value: ["a", "b"], ...base },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);

    const rows = await handle.db.select().from(facts).where(eq(facts.companyId, companyId));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get("product.count")?.valueNum).toBe("42");
    expect(byKey.get("product.count")?.area).toBe("product");
    expect(byKey.get("product.price_min")?.valueJson).toEqual({ amount: 19.5 });
    expect(byKey.get("product.price_min")?.currency).toBe("USD");
    expect(byKey.get("product.catalog_change_12m")?.valueNum).toBe("12.5");
    expect(byKey.get("financials.last_raise_date")?.valueDate).toBe("2025-06-01");
    expect(byKey.get("marketing.channel_active")?.valueBool).toBe(true);
    expect(byKey.get("marketing.channel_active")?.qualifiers).toEqual({ channel: "meta" });
    expect(byKey.get("reviews.app")?.valueText).toBe("Judge.me");
    expect(byKey.get("test.site_url")?.valueText).toBe("https://example.invalid/");
    expect(byKey.get("test.tags")?.valueJson).toEqual(["a", "b"]);
  });

  it("rejects mistyped values with the expected shape", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const base = { sourceIds: [sourceId], confidence: "high" };
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      facts: [
        { key: "product.count", value: "many", ...base },
        { key: "product.price_min", value: { amount: 5 }, ...base },
        { key: "financials.last_raise_date", value: "June 2025", ...base },
        { key: "marketing.channel_active", value: "yes", ...base },
      ],
    });
    expect(err(results, 0)).toContain("expected a JSON number");
    expect(err(results, 1)).toContain('money needs a currency code');
    expect(err(results, 2)).toContain('expected a date as "YYYY-MM-DD"');
    expect(err(results, 3)).toContain("expected true or false");
  });

  it("rejects unknown keys, qualifiers and sources, listing the valid ones", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const otherCompany = await makeCompany("Other Co");
    const otherRun = await makeRun(otherCompany);
    const otherSource = await makeSource(otherCompany, otherRun);
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      facts: [
        { key: "nope.missing", value: 1, sourceIds: [sourceId], confidence: "high" },
        { key: "product.count", value: 1, qualifiers: { nope: "x" }, sourceIds: [sourceId], confidence: "high" },
        { key: "product.count", value: 1, sourceIds: [], confidence: "high" },
        { key: "product.count", value: 1, sourceIds: [randomUUID()], confidence: "high" },
        { key: "product.count", value: 1, sourceIds: [otherSource], confidence: "high" },
        { key: "reviews.avg_rating", value: 4.5, qualifiers: { platform: 7 as unknown as string }, sourceIds: [sourceId], confidence: "high" },
      ],
    });
    expect(err(results, 0)).toContain('unknown fact key "nope.missing". Valid keys: ');
    expect(err(results, 0)).toContain("product.count");
    expect(err(results, 1)).toContain('unknown qualifier "nope"');
    expect(err(results, 2)).toContain("needs at least one source_id");
    expect(err(results, 3)).toContain("unknown source");
    expect(err(results, 4)).toContain("belongs to another company");
    expect(err(results, 5)).toContain('qualifier "platform" must be a string');
  });

  it("returns per-item ok/error without failing the batch", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      facts: [
        { key: "product.count", value: 3, sourceIds: [sourceId], confidence: "medium" },
        { key: "bogus", value: 1, sourceIds: [sourceId], confidence: "medium" },
      ],
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(await handle.db.select().from(facts)).toHaveLength(1);
  });

  it("facts_current returns the latest value per company, key and qualifiers", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const write = (qualifiers: Record<string, string>, value: number) =>
      addFacts(handle.db, {
        companyId,
        runId,
        createdBy: "collector:test",
        facts: [{ key: "reviews.avg_rating", value, qualifiers, sourceIds: [sourceId], confidence: "high" }],
      });
    const [first] = await write({ platform: "judge.me" }, 4.0);
    if (!first?.ok) throw new Error("first write failed");
    await handle.db.update(facts).set({ createdAt: new Date("2025-01-01") }).where(eq(facts.id, first.id));
    const [second] = await write({ platform: "judge.me" }, 4.8);
    if (!second?.ok) throw new Error("second write failed");
    await write({ platform: "yotpo" }, 3.5);

    const current = await handle.db.select().from(factsCurrent).where(eq(factsCurrent.companyId, companyId));
    expect(current).toHaveLength(2);
    const judge = current.find((r) => (r.qualifiers as Record<string, string>)["platform"] === "judge.me");
    expect(judge?.id).toBe(second.id);
    expect(judge?.valueNum).toBe("4.8");
  });
});

describe("records", () => {
  it("upserts on the natural key, merging data and unioning source ids", async () => {
    const companyId = await makeCompany();
    const runA = await makeRun(companyId, "succeeded");
    const runB = await makeRun(companyId);
    const sourceA = await makeSource(companyId, runA);
    const sourceB = await makeSource(companyId, runB, "http://example.invalid/other");
    const [created] = await upsertRecords(handle.db, {
      companyId,
      runId: runA,
      createdBy: "collector:test",
      records: [
        {
          type: "job_posting",
          data: { title: "Chemist", url: "http://example.invalid/j/1", location: "Portland" },
          sourceIds: [sourceA],
        },
      ],
    });
    expect(created).toMatchObject({ ok: true, created: true });
    const [updated] = await upsertRecords(handle.db, {
      companyId,
      runId: runB,
      createdBy: "collector:test",
      records: [
        {
          type: "job_posting",
          data: { title: "Chemist", url: "http://example.invalid/j/1", department: "R&D" },
          sourceIds: [sourceB],
        },
      ],
    });
    expect(updated).toMatchObject({ ok: true, created: false, id: (created as { id: string }).id });

    const rows = await handle.db.select().from(records).where(eq(records.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ title: "Chemist", location: "Portland", department: "R&D" });
    expect(rows[0]?.sourceIds).toEqual(expect.arrayContaining([sourceA, sourceB]));
    expect(rows[0]?.firstSeenRunId).toBe(runA);
    expect(rows[0]?.lastSeenRunId).toBe(runB);
    expect(rows[0]?.area).toBe("hiring");
  });

  it("rejects unknown types, fields and missing required fields", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const results = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      records: [
        { type: "nope", data: {}, sourceIds: [sourceId] },
        { type: "job_posting", data: { title: "T", url: "http://example.invalid/x", nope: 1 }, sourceIds: [sourceId] },
        { type: "job_posting", data: { url: "http://example.invalid/x" }, sourceIds: [sourceId] },
        { type: "job_posting", data: { title: "T", url: "not a url" }, sourceIds: [sourceId] },
        { type: "job_posting", data: { title: "T", url: "http://example.invalid/x" }, sourceIds: [] },
      ],
    });
    expect(err(results, 0)).toContain('unknown record type "nope". Valid types: ');
    expect(err(results, 0)).toContain("job_posting");
    expect(err(results, 1)).toContain('unknown field "nope". Valid fields: ');
    expect(err(results, 1)).toContain("title");
    expect(err(results, 2)).toContain('missing required field "title"');
    expect(err(results, 3)).toContain("expected an http(s) URL");
    expect(err(results, 4)).toContain("needs at least one source_id");
  });

  it("computes text_hash for review excerpts and rejects a supplied one", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [ok] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      records: [
        {
          type: "review_excerpt",
          data: { platform: "judge.me", text: "Great serum", url: "http://example.invalid/r/1" },
          sourceIds: [sourceId],
        },
      ],
    });
    expect(ok?.ok).toBe(true);
    const [row] = await handle.db.select().from(records).where(eq(records.companyId, companyId));
    expect(typeof (row?.data as Record<string, unknown>)["text_hash"]).toBe("string");

    const [bad] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      records: [
        {
          type: "review_excerpt",
          data: { platform: "judge.me", text: "Great serum", url: "http://example.invalid/r/1", text_hash: "x" },
          sourceIds: [sourceId],
        },
      ],
    });
    expect(bad?.ok).toBe(false);
    expect((bad as { error: string }).error).toContain("text_hash is server-computed");
  });
});

describe("registry writes", () => {
  it("rejects near-duplicate registrations, returning the match", async () => {
    await expect(
      registerFactKey(handle.db, { key: "product.counts", valueType: "number", description: "dup" }, "owner"),
    ).rejects.toThrow(/nearly duplicates: product\.count/);
    await expect(
      registerFactKey(handle.db, { key: "product_count", valueType: "number", description: "dup" }, "owner"),
    ).rejects.toThrow(/nearly duplicates: product\.count/);
    await expect(
      registerRecordType(
        handle.db,
        {
          name: "job_postin",
          description: "dup",
          fields: [{ name: "title", type: "text", required: true, description: "t" }],
          naturalKey: ["title"],
        },
        "owner",
      ),
    ).rejects.toThrow(/nearly duplicates: job_posting/);
  });

  it("registers provisional entries that are usable immediately", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const key = await registerFactKey(
      handle.db,
      { key: "reviews.video_count", area: "reviews", valueType: "number", description: "Video reviews" },
      "owner",
    );
    expect(key.status).toBe("provisional");
    const type = await registerRecordType(
      handle.db,
      {
        name: "video_review",
        area: "reviews",
        description: "A video review",
        fields: [{ name: "url", type: "url", required: true, description: "Video URL" }],
        naturalKey: ["url"],
      },
      "owner",
    );
    expect(type.status).toBe("provisional");

    const [fact] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "reviews.video_count", value: 7, sourceIds: [sourceId], confidence: "high" }],
    });
    expect(fact?.ok).toBe(true);
    const [record] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [{ type: "video_review", data: { url: "http://example.invalid/v/1" }, sourceIds: [sourceId] }],
    });
    expect(record?.ok).toBe(true);
  });

  it("validates registration shapes", async () => {
    await expect(
      registerFactKey(handle.db, { key: "Bad Key", valueType: "number", description: "x" }, "owner"),
    ).rejects.toThrow(/snake_case/);
    await expect(
      registerFactKey(handle.db, { key: "test.bad", valueType: "nope", description: "x" }, "owner"),
    ).rejects.toThrow(/unknown value type/);
    await expect(
      registerRecordType(
        handle.db,
        { name: "bad type", description: "x", fields: [], naturalKey: [] },
        "owner",
      ),
    ).rejects.toThrow(/snake_case/);
    await expect(
      registerRecordType(
        handle.db,
        {
          name: "bad_nk",
          description: "x",
          fields: [{ name: "title", type: "text", required: true, description: "t" }],
          naturalKey: ["missing"],
        },
        "owner",
      ),
    ).rejects.toThrow(/not a field/);
  });

  it("approves, renames and merges entries", async () => {
    // Unique names: approved entries survive resetTestDb, so a fixed name
    // would collide on the next run.
    const tag = randomUUID().slice(0, 8).replace(/[^a-z0-9]/g, "x");
    const temp = `test.temp_${tag}`;
    const renamedKey = `test.renamed_${tag}`;
    const mergeSrc = `test.merge_src_${tag}`;
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const key = await registerFactKey(
      handle.db,
      { key: temp, valueType: "number", description: "temp" },
      "owner",
    );
    expect(key.status).toBe("provisional");
    const approved = (await approveRegistryEntry(handle.db, { kind: "fact_key", name: temp })) as {
      status: string;
    };
    expect(approved.status).toBe("approved");

    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: temp, value: 1, sourceIds: [sourceId], confidence: "low" }],
    });
    await approveRegistryEntry(handle.db, { kind: "fact_key", name: temp, renameTo: renamedKey });
    const renamed = await handle.db.select().from(facts).where(eq(facts.companyId, companyId));
    expect(renamed.map((r) => r.key)).toEqual([renamedKey]);

    await registerFactKey(handle.db, { key: mergeSrc, valueType: "number", description: "src" }, "owner");
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: mergeSrc, value: 2, sourceIds: [sourceId], confidence: "low" }],
    });
    const merged = await approveRegistryEntry(handle.db, {
      kind: "fact_key",
      name: mergeSrc,
      mergeInto: renamedKey,
    });
    expect(merged).toEqual({ mergedInto: renamedKey });
    const after = await handle.db.select().from(facts).where(eq(facts.companyId, companyId));
    expect(after.map((r) => r.key).sort()).toEqual([renamedKey, renamedKey]);

    await handle.db.delete(facts).where(eq(facts.companyId, companyId));
    await handle.db.delete(factKeys).where(eq(factKeys.key, renamedKey));
  });
});

describe("documents, findings and statuses", () => {
  it("saves documents with validated kind, area and sources", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const id = await saveDocument(handle.db, {
      companyId,
      runId,
      area: "product",
      kind: "extract",
      title: "About extract",
      contentMd: "hello",
      sourceIds: [sourceId],
      createdBy: "collector:test",
    });
    const [row] = await handle.db.select().from(documents).where(eq(documents.id, id));
    expect(row?.createdBy).toBe("collector:test");
    await expect(
      saveDocument(handle.db, {
        companyId,
        kind: "nope",
        title: "t",
        contentMd: "c",
        createdBy: "x",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("adds findings citing sources, facts and records", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [fact] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "product.count", value: 9, sourceIds: [sourceId], confidence: "high" }],
    });
    if (!fact?.ok) throw new Error("fact write failed");
    const id = await addFinding(handle.db, {
      companyId,
      runId,
      area: "product",
      claim: "Small catalog",
      sourceIds: [sourceId],
      factIds: [fact.id],
      confidence: "medium",
      status: "supported",
      createdBy: "owner",
    });
    const [row] = await handle.db.select().from(findings).where(eq(findings.id, id));
    expect(row?.factIds).toEqual([fact.id]);
    await expect(
      addFinding(handle.db, {
        companyId,
        area: "product",
        claim: "No sources",
        sourceIds: [],
        confidence: "low",
        status: "unverified",
        createdBy: "owner",
      }),
    ).rejects.toThrow(/at least one source_id/);
    await expect(
      addFinding(handle.db, {
        companyId,
        area: "product",
        claim: "Bad fact",
        sourceIds: [sourceId],
        factIds: [randomUUID()],
        confidence: "low",
        status: "unverified",
        createdBy: "owner",
      }),
    ).rejects.toThrow(/unknown fact/);
  });

  it("sets area statuses with reason rules", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    await setAreaStatus(handle.db, { runId, area: "hiring", status: "done" });
    await setAreaStatus(handle.db, { runId, area: "product", status: "not_found", reason: "no catalog" });
    await expect(setAreaStatus(handle.db, { runId, area: "reviews", status: "blocked" })).rejects.toThrow(
      /needs a reason/,
    );
    const rows = await handle.db.select().from(areaStatuses).where(eq(areaStatuses.runId, runId));
    expect(rows).toHaveLength(2);
  });
});
