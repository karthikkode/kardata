import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, documents, researchRuns, sources } from "../../src/db/schema.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { redactReviewerNames, redactRunDocs } from "../../src/domain/research/pii.js";
import { scorecard } from "../../src/domain/research/scorecard.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

describe("redactReviewerNames", () => {
  it("redacts first-name-plus-initial near review words", () => {
    const { text, hits } = redactReviewerNames(
      `Top themes: "cleared my skin in a week" — Sarah K., verified review. ` +
        `Mike T. says the pump broke after a month (2 stars).`,
    );
    expect(hits).toBe(2);
    expect(text).toContain("[redacted], verified review");
    expect(text).toContain("[redacted] says the pump");
    expect(text).not.toContain("Sarah K.");
    expect(text).not.toContain("Mike T.");
  });

  it("leaves the same shape alone away from review words", () => {
    const { text, hits } = redactReviewerNames(
      "Founder Jane D. launched the brand in 2019. Vitamin C is the hero ingredient.",
    );
    expect(hits).toBe(0);
    expect(text).toContain("Jane D.");
    expect(text).toContain("Vitamin C");
  });

  it("does not fire on unverified or non-review names", () => {
    const { hits } = redactReviewerNames(
      "Self-funding signal (unverified): the Alpha M. Podcast episode lists the launch story.",
    );
    expect(hits).toBe(0);
  });

  it("fires on platform-cited names, not on reports-to prose", () => {
    const hit = redactReviewerNames(
      "Some report onset within days (SmartCustomer: Kimberly T. Jun 2025, Deloris W. May 2024).",
    );
    expect(hit.hits).toBe(2);
    expect(hit.text).not.toContain("Kimberly T.");
    const miss = redactReviewerNames("Head of Sales Jane D. reports to the CEO since 2023.");
    expect(miss.hits).toBe(0);
  });

  it("is idempotent", () => {
    const once = redactReviewerNames(`"love it" — Anna B., 5 stars.`);
    const twice = redactReviewerNames(once.text);
    expect(once.hits).toBe(1);
    expect(twice.hits).toBe(0);
    expect(twice.text).toBe(once.text);
  });
});

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
    .values({ id: randomUUID(), source: "manual", name: "PII Co" })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeAgentRun(companyId: string): Promise<string> {
  const [row] = await handle.db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "agent", status: "succeeded", batchId: randomUUID() })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("no run row");
  return row.id;
}

async function makeSource(companyId: string, runId: string): Promise<string> {
  const [row] = await handle.db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId,
      runId,
      url: "https://example.com/r",
      finalUrl: "https://example.com/r",
      collector: "test",
      status: "ok",
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("no source row");
  return row.id;
}

describe("redactRunDocs", () => {
  it("redacts agent docs in new versions and counts hits in the scorecard", async () => {
    const companyId = await makeCompany();
    const runId = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "reviews/summary.md",
      contentMd: `"cleared my skin" — Sarah K., verified review.`,
      sourceIds: [sourceId],
      createdBy: `agent:${runId}`,
    });
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "product/catalog.md",
      contentMd: "Three SKUs, hero is Glow Cream.",
      sourceIds: [sourceId],
      createdBy: `agent:${runId}`,
    });

    const redacted = await redactRunDocs(handle.db, runId);
    expect(redacted).toEqual([{ path: "reviews/summary.md", hits: 1 }]);

    const current = await handle.db
      .select()
      .from(documents)
      .where(and(eq(documents.runId, runId), eq(documents.isCurrent, true)));
    expect(current).toHaveLength(2);
    const summary = current.find((d) => d.path === "reviews/summary.md");
    expect(summary?.version).toBe(2);
    expect(summary?.createdBy).toBe("owner");
    expect(summary?.contentMd).toContain("[redacted]");
    expect(summary?.contentMd).not.toContain("Sarah K.");
    // A re-scan finds nothing: 0 PII hits after redaction.
    expect(redactReviewerNames(summary?.contentMd ?? "").hits).toBe(0);

    const card = await scorecard(handle.db, { runIds: [runId] });
    expect(card.runs[0]?.piiRedactions).toBe(1);
    expect(card.totals.piiRedactions).toBe(1);
  });

  it("leaves runs without hits untouched", async () => {
    const companyId = await makeCompany();
    const runId = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "reviews/summary.md",
      contentMd: "Ratings are high across platforms.",
      sourceIds: [sourceId],
      createdBy: `agent:${runId}`,
    });
    await expect(redactRunDocs(handle.db, runId)).resolves.toEqual([]);
    const card = await scorecard(handle.db, { runIds: [runId] });
    expect(card.runs[0]?.piiRedactions).toBe(0);
  });
});
