import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  areaStatuses,
  blobs,
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
import { addFacts, type AddFactResult } from "../../src/domain/research/facts.js";
import { upsertRecords, type UpsertRecordResult } from "../../src/domain/research/records.js";
import {
  curateRegistryEntry,
  describeRegistryEntry,
  listRegistry,
} from "../../src/domain/research/registry.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { addFinding } from "../../src/domain/research/findings.js";
import { setAreaStatus } from "../../src/domain/research/status.js";
import { captureSource } from "../../src/domain/research/sources.js";
import { reviewsIngest } from "../../src/domain/research/reviews.js";
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

function okFact(r: AddFactResult | undefined): { id: string; warnings: string[] } {
  if (!r || !r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}

function errFact(r: AddFactResult | undefined): string {
  if (!r || r.ok) throw new Error("expected rejected");
  return r.error;
}

function okRecord(r: UpsertRecordResult | undefined) {
  if (!r || !r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}

describe("seed registry", () => {
  it("holds 29 approved fact keys and 11 approved record types", async () => {
    const keys = await handle.db.select().from(factKeys).where(eq(factKeys.createdBy, "seed"));
    const types = await handle.db.select().from(recordTypes).where(eq(recordTypes.createdBy, "seed"));
    expect(keys).toHaveLength(29);
    expect(types).toHaveLength(11);
    expect(keys.every((k) => k.status === "approved")).toBe(true);
    expect(types.every((t) => t.status === "approved")).toBe(true);
    const names = types.map((t) => t.name);
    expect(names).toContain("review");
    expect(names).not.toContain("review_excerpt");
    const review = types.find((t) => t.name === "review");
    expect(review?.naturalKey).toEqual(["platform", "text", "date"]);
    expect(review?.fields.every((f) => !("required" in f))).toBe(true);
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
    const base = { sourceIds: [sourceId], confidence: "high" };
    // url, text_list and json have no seeds, so they auto-create provisional keys.
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [
        { key: "product.count", value: 42, ...base },
        { key: "product.price_min", value: { amount: 19.5, currency: "usd" }, ...base },
        { key: "product.catalog_change_12m", value: 12.5, ...base },
        { key: "financials.last_raise_date", value: "2025-06-01", ...base },
        { key: "marketing.channel_active", value: true, qualifiers: { channel: "meta" }, ...base },
        { key: "reviews.app", value: "Judge.me", ...base },
        { key: "test.site_url", value: "https://example.invalid/", ...base },
        { key: "test.tags", value: ["a", "b"], ...base },
        { key: "test.blob", value: { nested: [1, 2] }, ...base },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);

    const rows = await handle.db.select().from(facts).where(eq(facts.companyId, companyId));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get("product.count")?.valueNum).toBe("42");
    expect(byKey.get("product.price_min")?.valueJson).toEqual({ amount: 19.5 });
    expect(byKey.get("product.price_min")?.currency).toBe("USD");
    expect(byKey.get("financials.last_raise_date")?.valueDate).toBe("2025-06-01");
    expect(byKey.get("marketing.channel_active")?.valueBool).toBe(true);
    expect(byKey.get("reviews.app")?.valueText).toBe("Judge.me");
    expect(byKey.get("test.site_url")?.valueText).toBe("https://example.invalid/");
    expect(byKey.get("test.tags")?.valueJson).toEqual(["a", "b"]);
    expect(byKey.get("test.blob")?.valueJson).toEqual({ nested: [1, 2] });
    const [blob] = await handle.db.select().from(factKeys).where(eq(factKeys.key, "test.blob"));
    expect(blob?.status).toBe("provisional");
    expect(blob?.valueType).toBe("json");
  });

  it("auto-creates unknown keys and qualifiers with warnings", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [created] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [
        {
          key: "packaging.recycled_share",
          value: 0.4,
          qualifiers: { line: "bottles" },
          sourceIds: [sourceId],
        },
      ],
    });
    const ok = okFact(created);
    expect(ok.warnings.join(" ")).toContain('created provisional key "packaging.recycled_share"');
    const [key] = await handle.db.select().from(factKeys).where(eq(factKeys.key, "packaging.recycled_share"));
    expect(key?.status).toBe("provisional");
    expect(key?.valueType).toBe("number");
    expect(key?.area).toBeNull();
    expect(key?.qualifierNames).toEqual(["line"]);
    expect(key?.useCount).toBe(1);
    expect(key?.firstUsedAt).not.toBeNull();

    // A new qualifier on an approved key is added, with a warning.
    // Unique per run: registry mutations survive resetTestDb.
    const qualifier = `warehouse_${randomUUID().slice(0, 8)}`;
    const [second] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [
        { key: "product.count", value: 9, qualifiers: { [qualifier]: "east" }, sourceIds: [sourceId] },
      ],
    });
    expect(okFact(second).warnings.join(" ")).toContain(`new qualifier(s) ${qualifier}`);
    const [count] = await handle.db.select().from(factKeys).where(eq(factKeys.key, "product.count"));
    expect(count?.qualifierNames).toContain(qualifier);
    await handle.db
      .update(factKeys)
      .set({ qualifierNames: (count?.qualifierNames ?? []).filter((q) => q !== qualifier) })
      .where(eq(factKeys.key, "product.count"));
  });

  it("accepts near-duplicates with a warning naming the match", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [r] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "product.counts", value: 1, sourceIds: [sourceId] }],
    });
    const ok = okFact(r);
    expect(ok.warnings.join(" ")).toContain("nearly duplicates existing: product.count");
  });

  it("rejects a bad value for an approved key, but widens a provisional one", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [rejected] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "product.count", value: "many", sourceIds: [sourceId] }],
    });
    expect(errFact(rejected)).toContain('approved key "product.count" takes number');

    const [first] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "test.wide", value: 5, sourceIds: [sourceId] }],
    });
    expect(okFact(first).id).toBeTruthy();
    const [widened] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "test.wide", value: "N/A", sourceIds: [sourceId] }],
    });
    expect(okFact(widened).warnings.join(" ")).toContain('widened from number to text');
    const [again] = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "test.wide", value: { odd: true }, sourceIds: [sourceId] }],
    });
    expect(okFact(again).warnings.join(" ")).toContain("widened from text to json");
    const [key] = await handle.db.select().from(factKeys).where(eq(factKeys.key, "test.wide"));
    expect(key?.valueType).toBe("json");
  });

  it("rejects missing and out-of-scope sources", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const otherCompany = await makeCompany("Other Co");
    const otherRun = await makeRun(otherCompany);
    const otherSource = await makeSource(otherCompany, otherRun);
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [
        { key: "product.count", value: 1, sourceIds: [] },
        { key: "product.count", value: 1, sourceIds: [randomUUID()] },
        { key: "product.count", value: 1, sourceIds: [otherSource] },
        { key: "product.count", value: 1, sourceIds: [sourceId] },
      ],
    });
    expect(errFact(results[0])).toContain("needs at least one source_id");
    expect(errFact(results[1])).toContain("unknown source");
    expect(errFact(results[2])).toContain("belongs to another company");
    expect(okFact(results[3]).id).toBeTruthy();
  });

  it("chunks an over-size batch and gates everything in strict mode", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const many = Array.from({ length: 201 }, () => ({ key: "product.count", value: 1, sourceIds: [sourceId] }));
    const chunked = await addFacts(handle.db, { companyId, runId, createdBy: "owner", facts: many });
    expect(chunked).toHaveLength(201);
    expect(chunked.every((r) => r.ok)).toBe(true);
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      strict: true,
      facts: [
        { key: "nope.missing", value: 1, sourceIds: [sourceId] },
        { key: "product.count", value: 1, qualifiers: { nope: "x" }, sourceIds: [sourceId] },
        { key: "product.count", value: "many", sourceIds: [sourceId] },
      ],
    });
    expect(errFact(results[0])).toContain('unknown fact key "nope.missing"');
    expect(errFact(results[1])).toContain('unknown qualifier "nope"');
    expect(errFact(results[2])).toContain("expected a JSON number");
  });

  it("facts_current returns the latest value per company, key and qualifiers", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const write = (qualifiers: Record<string, string>, value: number) =>
      addFacts(handle.db, {
        companyId,
        runId,
        createdBy: "owner",
        facts: [{ key: "reviews.avg_rating", value, qualifiers, sourceIds: [sourceId], confidence: "high" }],
      });
    const [first] = await write({ platform: "judge.me" }, 4.0);
    const firstId = okFact(first).id;
    await handle.db.update(facts).set({ createdAt: new Date("2025-01-01") }).where(eq(facts.id, firstId));
    const [second] = await write({ platform: "judge.me" }, 4.8);
    const secondId = okFact(second).id;
    await write({ platform: "yotpo" }, 3.5);

    const current = await handle.db.select().from(factsCurrent).where(eq(factsCurrent.companyId, companyId));
    expect(current).toHaveLength(2);
    const judge = current.find((r) => (r.qualifiers as Record<string, string>)["platform"] === "judge.me");
    expect(judge?.id).toBe(secondId);
    expect(judge?.valueNum).toBe("4.8");
  });
});

describe("records", () => {
  it("upserts on the natural key: created, updated, unchanged", async () => {
    const companyId = await makeCompany();
    const runA = await makeRun(companyId, "succeeded");
    const runB = await makeRun(companyId);
    const sourceA = await makeSource(companyId, runA);
    const sourceB = await makeSource(companyId, runB, "http://example.invalid/other");
    const base = { type: "job_posting", data: { title: "Chemist", url: "http://example.invalid/j/1" } };
    const [created] = await upsertRecords(handle.db, {
      companyId,
      runId: runA,
      createdBy: "owner",
      records: [{ ...base, sourceIds: [sourceA] }],
    });
    expect(okRecord(created).outcome).toBe("created");

    const [same] = await upsertRecords(handle.db, {
      companyId,
      runId: runB,
      createdBy: "owner",
      records: [{ ...base, sourceIds: [sourceA] }],
    });
    expect(okRecord(same).outcome).toBe("unchanged");

    const [updated] = await upsertRecords(handle.db, {
      companyId,
      runId: runB,
      createdBy: "owner",
      records: [
        {
          ...base,
          data: { ...base.data, department: "R&D" },
          sourceIds: [sourceB],
        },
      ],
    });
    const up = okRecord(updated);
    expect(up.outcome).toBe("updated");
    expect(up.id).toBe(okRecord(created).id);

    const rows = await handle.db.select().from(records).where(eq(records.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ title: "Chemist", department: "R&D" });
    expect(rows[0]?.sourceIds).toEqual(expect.arrayContaining([sourceA, sourceB]));
    expect(rows[0]?.firstSeenRunId).toBe(runA);
    expect(rows[0]?.lastSeenRunId).toBe(runB);
  });

  it("auto-creates unknown types and fields with warnings, keeps mistyped fields", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [created] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [
        {
          type: "pop_up_shop",
          data: { name: "Soho popup", visitors: 500, url: "http://example.invalid/popup" },
          sourceIds: [sourceId],
        },
      ],
    });
    expect(okRecord(created).warnings.join(" ")).toContain('created provisional record type "pop_up_shop"');
    const [type] = await handle.db.select().from(recordTypes).where(eq(recordTypes.name, "pop_up_shop"));
    expect(type?.status).toBe("provisional");
    expect(type?.naturalKey).toEqual(["url"]);

    const field = `shift_${randomUUID().slice(0, 8)}`;
    const [withField] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [
        {
          type: "job_posting",
          data: { title: "T", url: "http://example.invalid/x", [field]: "nights" },
          sourceIds: [sourceId],
        },
      ],
    });
    expect(okRecord(withField).warnings.join(" ")).toContain(`added field(s) ${field} to "job_posting"`);
    const [jobType] = await handle.db.select().from(recordTypes).where(eq(recordTypes.name, "job_posting"));
    await handle.db
      .update(recordTypes)
      .set({ fields: (jobType?.fields ?? []).filter((f) => f.name !== field) })
      .where(eq(recordTypes.name, "job_posting"));

    const [mistyped] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [
        {
          type: "job_posting",
          data: { title: "T2", url: "http://example.invalid/y", comp_min: "lots" },
          sourceIds: [sourceId],
        },
      ],
    });
    const ok = okRecord(mistyped);
    expect(ok.warnings.join(" ")).toContain('field "comp_min" kept as given (expected number)');
    const [row] = await handle.db.select().from(records).where(eq(records.id, ok.id));
    expect((row?.data as Record<string, unknown>)["comp_min"]).toBe("lots");
  });

  it("accepts near-duplicate types with a warning, rejects without sources", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [near] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [{ type: "job_postin", data: { title: "T" }, sourceIds: [sourceId] }],
    });
    expect(okRecord(near).warnings.join(" ")).toContain("nearly duplicates existing: job_posting");
    const [noSources] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [{ type: "job_posting", data: { title: "T", url: "http://example.invalid/z" }, sourceIds: [] }],
    });
    expect(noSources?.ok).toBe(false);
  });

  it("uses a per-item natural key and gates in strict mode", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const [a] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [
        {
          type: "retailer",
          data: { name: "Boots", country: "UK" },
          naturalKey: ["name", "country"],
          sourceIds: [sourceId],
        },
      ],
    });
    expect(okRecord(a).outcome).toBe("created");
    const [b] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [
        {
          type: "retailer",
          data: { name: "Boots", country: "US" },
          naturalKey: ["name", "country"],
          sourceIds: [sourceId],
        },
      ],
    });
    expect(okRecord(b).outcome).toBe("created");
    expect(okRecord(b).id).not.toBe(okRecord(a).id);

    const [strict] = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      strict: true,
      records: [{ type: "nope", data: { a: 1 }, sourceIds: [sourceId] }],
    });
    expect(strict?.ok).toBe(false);
  });
});

describe("registry describe and curate", () => {
  it("describes auto-created entries", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      facts: [{ key: "test.doodle", value: 1, sourceIds: [sourceId] }],
    });
    await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "owner",
      records: [{ type: "doodle", data: { color: "red" }, sourceIds: [sourceId] }],
    });
    const keyResult = await describeRegistryEntry(handle.db, { name: "test.doodle", description: "Doodle count" });
    expect(keyResult.kind).toBe("fact_key");
    const typeResult = await describeRegistryEntry(handle.db, {
      name: "doodle",
      description: "A doodle",
      fields: [{ name: "color", description: "Doodle color" }],
    });
    expect(typeResult.kind).toBe("record_type");
    const [key] = await handle.db.select().from(factKeys).where(eq(factKeys.key, "test.doodle"));
    expect(key?.description).toBe("Doodle count");
    const [type] = await handle.db.select().from(recordTypes).where(eq(recordTypes.name, "doodle"));
    expect(type?.description).toBe("A doodle");
    expect(type?.fields).toEqual([{ name: "color", type: "text", description: "Doodle color" }]);
  });

  it("curates: approve, rename, merge; near-dup rename rejected", async () => {
    const tag = randomUUID().slice(0, 8).replace(/[^a-z0-9]/g, "x");
    const temp = `test.temp_${tag}`;
    const renamedKey = `test.renamed_${tag}`;
    const mergeSrc = `test.merge_src_${tag}`;
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const write = (key: string, value: number) =>
      addFacts(handle.db, {
        companyId,
        runId,
        createdBy: "owner",
        facts: [{ key, value, sourceIds: [sourceId] }],
      });
    await write(temp, 1);
    const approved = (await curateRegistryEntry(handle.db, { name: temp, approve: true })) as { status: string };
    expect(approved.status).toBe("approved");

    await curateRegistryEntry(handle.db, { name: temp, renameTo: renamedKey });
    const renamed = await handle.db.select().from(facts).where(eq(facts.companyId, companyId));
    expect(renamed.map((r) => r.key)).toEqual([renamedKey]);

    await write(mergeSrc, 2);
    const merged = await curateRegistryEntry(handle.db, { name: mergeSrc, mergeInto: renamedKey });
    expect(merged).toEqual({ mergedInto: renamedKey });

    await expect(curateRegistryEntry(handle.db, { name: renamedKey, renameTo: "product.counts" })).rejects.toThrow(
      /nearly duplicates/,
    );
    await handle.db.delete(facts).where(eq(facts.companyId, companyId));
    await handle.db.delete(factKeys).where(eq(factKeys.key, renamedKey));
  });
});

describe("documents", () => {
  it("versions by path: created, updated, unchanged", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const input = {
      companyId,
      runId,
      path: "reviews/complaints-packaging.md",
      kind: "report",
      title: "Packaging complaints",
      sourceIds: [sourceId],
      createdBy: "owner",
    };
    const v1 = await saveDocument(handle.db, { ...input, contentMd: "v1" });
    expect(v1).toMatchObject({ version: 1, outcome: "created" });
    const same = await saveDocument(handle.db, { ...input, contentMd: "v1" });
    expect(same).toMatchObject({ version: 1, outcome: "unchanged", id: v1.id });
    const v2 = await saveDocument(handle.db, { ...input, contentMd: "v2" });
    expect(v2).toMatchObject({ version: 2, outcome: "updated" });

    const rows = await handle.db.select().from(documents).where(eq(documents.companyId, companyId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(rows.find((r) => r.isCurrent)?.area).toBe("reviews");
  });

  it("sets area other for non-area folders and rejects bad paths and big saves", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const v1 = await saveDocument(handle.db, {
      companyId,
      runId,
      path: "founder/story.md",
      contentMd: "hi",
      createdBy: "owner",
    });
    expect(v1.outcome).toBe("created");
    const [row] = await handle.db.select().from(documents).where(eq(documents.id, v1.id));
    expect(row?.area).toBe("other");
    expect(row?.title).toBe("story");

    await expect(
      saveDocument(handle.db, { companyId, path: "Bad Path.txt", contentMd: "x", createdBy: "owner" }),
    ).rejects.toThrow(/malformed document path/);
    await expect(
      saveDocument(handle.db, {
        companyId,
        path: "reviews/big.md",
        contentMd: "x".repeat(500 * 1024 + 1),
        createdBy: "owner",
      }),
    ).rejects.toThrow(/split into several files/);
  });
});

describe("findings, statuses and captures", () => {
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
    const factId = okFact(fact).id;
    const id = await addFinding(handle.db, {
      companyId,
      runId,
      area: "product",
      claim: "Small catalog",
      sourceIds: [sourceId],
      factIds: [factId],
      confidence: "medium",
      status: "supported",
      tags: ["catalog"],
      createdBy: "owner",
    });
    const [row] = await handle.db.select().from(findings).where(eq(findings.id, id));
    expect(row?.factIds).toEqual([factId]);
    expect(row?.tags).toEqual(["catalog"]);
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

  it("captures off-path content as a source with a blob", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const id = await captureSource(handle.db, {
      companyId,
      runId,
      url: "https://example.invalid/article",
      title: "A hit",
      text: "snippet text",
      via: "search",
      createdBy: "owner",
    });
    const [source] = await handle.db.select().from(sources).where(eq(sources.id, id));
    expect(source?.collector).toBe("capture");
    expect(source?.via).toBe("search");
    expect(source?.title).toBe("A hit");
    const [blob] = await handle.db.select().from(blobs).where(eq(blobs.sha256, source?.blobSha256 ?? ""));
    expect(blob?.size).toBe("snippet text".length);
    await expect(
      captureSource(handle.db, {
        companyId,
        runId,
        url: "https://example.invalid/x",
        text: "t",
        via: "smoke-signal",
        createdBy: "owner",
      }),
    ).rejects.toThrow(/via must be/);
  });
});

describe("reviews_ingest", () => {
  it("ingests, dedupes, strips identity and recomputes facts", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const input = {
      companyId,
      runId,
      platform: "judge.me",
      sourceId,
      createdBy: "owner",
      reviews: [
        {
          text: "  Great   serum! ",
          rating: 5,
          date: "2026-09-01",
          reviewer_name: "Jane D",
          email: "jane@example.invalid",
          color: "amber",
        },
        { text: "Okay cleanser", rating: 8, rating_scale: 10, date: "October 5, 2026" },
      ],
    };
    const first = await reviewsIngest(handle.db, input);
    expect(first.results.map((r) => (r.ok ? r.outcome : "rejected"))).toEqual(["created", "created"]);
    expect(first.results[0]?.ok && first.results[0].warnings.join(" ")).toContain("dropped reviewer-identity");
    expect(first.trimmed).toBe(0);
    expect(first.recomputed).toEqual(
      expect.arrayContaining([
        "reviews.ingested_count",
        "reviews.avg_rating",
        "reviews.rating_distribution",
        "reviews.oldest_review_date",
        "reviews.newest_review_date",
      ]),
    );

    const rows = await handle.db.select().from(records).where(eq(records.companyId, companyId));
    expect(rows).toHaveLength(2);
    const serum = rows.find((r) => ((r.data as Record<string, unknown>)["text"] as string).includes("serum"));
    expect(serum?.area).toBe("reviews");
    const data = serum?.data as Record<string, unknown>;
    expect(data["reviewer_name"]).toBeUndefined();
    expect(data["email"]).toBeUndefined();
    expect(data["text"]).toBe("  Great   serum! ");
    expect(data["color"]).toBe("amber");

    const current = await handle.db.select().from(factsCurrent).where(eq(factsCurrent.companyId, companyId));
    const byKey = new Map(current.map((r) => [r.key, r]));
    expect(byKey.get("reviews.ingested_count")?.valueNum).toBe("2");
    expect(byKey.get("reviews.avg_rating")?.valueNum).toBe("4.5");
    expect(byKey.get("reviews.rating_distribution")?.valueJson).toEqual({ "1": 0, "2": 0, "3": 0, "4": 1, "5": 1 });
    expect(byKey.get("reviews.oldest_review_date")?.valueDate).toBe("2026-09-01");
    expect(byKey.get("reviews.newest_review_date")?.valueDate).toBe("2026-10-05");

    // Re-ingesting is a no-op (dedupe on normalized text).
    const second = await reviewsIngest(handle.db, input);
    expect(second.results.map((r) => (r.ok ? r.outcome : "rejected"))).toEqual(["unchanged", "unchanged"]);
    const again = await handle.db.select().from(records).where(eq(records.companyId, companyId));
    expect(again).toHaveLength(2);
  });

  it("keeps the most recent 5,000 per platform", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    await handle.db.execute(sql`
      INSERT INTO records (id, company_id, type, area, natural_key_hash, data, source_ids, created_by)
      SELECT gen_random_uuid(), ${companyId}, 'review', 'reviews', 'cap-' || g,
        jsonb_build_object('platform', 'judge.me', 'text', 'old review ' || g,
          'date', (current_date - (g % 100) * interval '1 day')::date::text),
        ARRAY[${sourceId}]::uuid[], 'owner'
      FROM generate_series(1, 5005) AS g`);
    const result = await reviewsIngest(handle.db, {
      companyId,
      runId,
      platform: "judge.me",
      sourceId,
      createdBy: "owner",
      reviews: [{ text: "Brand new review", rating: 5, date: "2026-10-20" }],
    });
    expect(result.trimmed).toBe(6);
    const [{ count }] = await handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(records)
      .where(eq(records.companyId, companyId));
    expect(count).toBe(5000);
  });
});
