import { and, eq, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import { companies, records, researchRuns, sources } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { addFacts } from "./facts.js";
import { upsertRecords, type UpsertRecordResult } from "./records.js";

export const REVIEWS_BATCH_MAX = 500;
export const REVIEWS_PLATFORM_CAP = 5000;

// Reviewer identity is dropped by the server, even if sent. Exact field names
// (normalized) plus high-precision substrings.
const IDENTITY_FIELDS = new Set([
  "name",
  "names",
  "author",
  "authors",
  "user",
  "users",
  "userid",
  "username",
  "handle",
  "handles",
  "reviewer",
  "reviewername",
  "avatar",
  "avatarurl",
  "email",
  "revieweremail",
  "location",
  "city",
  "address",
  "zip",
  "zipcode",
  "postcode",
  "postalcode",
  "phone",
  "street",
  "profile",
  "profileurl",
  "image",
  "photo",
]);
const IDENTITY_SUBSTRINGS = ["email", "avatar", "username", "reviewer", "address", "postcode", "postal"];

function isIdentityField(name: string): boolean {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (IDENTITY_FIELDS.has(norm)) return true;
  return IDENTITY_SUBSTRINGS.some((s) => norm.includes(s));
}

export interface IngestReview {
  text: string;
  rating?: number | null;
  rating_scale?: number | null;
  title?: string | null;
  date?: string | null;
  product?: string | null;
  verified_buyer?: boolean | null;
  url?: string | null;
  language?: string | null;
  helpful_count?: number | null;
  reply_text?: string | null;
  [extra: string]: unknown;
}

export interface ReviewsIngestInput {
  companyId: string;
  runId?: string | null;
  platform: string;
  sourceId: string;
  reviews: IngestReview[];
  createdBy: string;
}

export interface ReviewsIngestResult {
  results: UpsertRecordResult[];
  recomputed: string[];
  trimmed: number;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const d = new Date(`${raw.trim()}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw.trim() ? raw.trim() : null;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  // Local date parts: "October 5, 2026" means Oct 5 in any timezone.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function reviewsIngest(db: DbLike, input: ReviewsIngestInput): Promise<ReviewsIngestResult> {
  // No cap: the MCP layer enforces the per-call limit. The single
  // upsertRecords call chunks internally; trim and recompute run once.
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  if (input.platform.trim() === "") throw new DomainError("invalid_input", "platform is required");
  const platform = input.platform.trim();
  if (input.runId) {
    const [run] = await db
      .select({ id: researchRuns.id, companyId: researchRuns.companyId })
      .from(researchRuns)
      .where(eq(researchRuns.id, input.runId));
    if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
    if (run.companyId !== input.companyId) {
      throw new DomainError("invalid_input", `run ${input.runId} belongs to another company`);
    }
  }
  const [source] = await db
    .select({ id: sources.id, companyId: sources.companyId })
    .from(sources)
    .where(eq(sources.id, input.sourceId));
  if (!source) throw new DomainError("invalid_input", `unknown source ${input.sourceId}`);
  if (source.companyId !== input.companyId) {
    throw new DomainError("invalid_input", `source ${input.sourceId} belongs to another company`);
  }

  const items = input.reviews.map((review) => toRecordItem(platform, input.sourceId, review));
  const results = await upsertRecords(db, {
    companyId: input.companyId,
    runId: input.runId ?? null,
    createdBy: input.createdBy,
    records: items,
  });
  results.forEach((result, i) => {
    const dropped = items[i]?.dropped ?? [];
    if (result.ok && dropped.length > 0) {
      result.warnings.push(`dropped reviewer-identity fields: ${dropped.join(", ")}`);
    }
  });

  // Over the cap: keep the most recent 5,000 (dated first, then by ingest).
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(records)
    .where(
      and(
        eq(records.companyId, input.companyId),
        eq(records.type, "review"),
        sql`${records.data}->>'platform' = ${platform}`,
      ),
    );
  let trimmed = 0;
  if ((count ?? 0) > REVIEWS_PLATFORM_CAP) {
    const surplus = await db
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.companyId, input.companyId),
          eq(records.type, "review"),
          sql`${records.data}->>'platform' = ${platform}`,
        ),
      )
      .orderBy(
        sql`${records.data}->>'date' DESC NULLS LAST`,
        sql`${records.createdAt} DESC`,
        sql`${records.id} DESC`,
      )
      .offset(REVIEWS_PLATFORM_CAP);
    trimmed = surplus.length;
    for (const row of surplus) {
      await db.delete(records).where(eq(records.id, row.id));
    }
  }

  const recomputed = await recomputeReviewFacts(db, input, platform);
  return { results, recomputed, trimmed };
}

function toRecordItem(platform: string, sourceId: string, review: IngestReview) {
  const data: Record<string, unknown> = { platform };
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(review)) {
    if (value === undefined || value === null) continue;
    if (isIdentityField(name)) {
      dropped.push(name);
      continue;
    }
    data[name] = value;
  }
  if (typeof data["text"] !== "string" || (data["text"] as string).trim() === "") {
    // upsertRecords rejects empty data; an empty review carries its marker here.
    data["text"] = "";
  }
  const normalized = normalizeText(typeof data["text"] === "string" ? (data["text"] as string) : "");
  const dateKey = normalizeDate(data["date"]) ?? (typeof data["date"] === "string" ? data["date"] : "");
  return {
    type: "review",
    data,
    sourceIds: [sourceId],
    keyValues: { platform, text: normalized, date: dateKey },
    dropped,
  };
}

async function recomputeReviewFacts(
  db: DbLike,
  input: ReviewsIngestInput,
  platform: string,
): Promise<string[]> {
  const rows = await db
    .select({ data: records.data })
    .from(records)
    .where(
      and(
        eq(records.companyId, input.companyId),
        eq(records.type, "review"),
        sql`${records.data}->>'platform' = ${platform}`,
      ),
    );
  if (rows.length === 0) return [];
  const asOf = new Date().toISOString().slice(0, 10);
  const written: string[] = [];
  const write = async (key: string, value: unknown) => {
    const [result] = await addFacts(db, {
      companyId: input.companyId,
      runId: input.runId ?? null,
      createdBy: input.createdBy,
      facts: [
        {
          key,
          value,
          qualifiers: { platform },
          asOf,
          sourceIds: [input.sourceId],
          confidence: "high",
        },
      ],
    });
    if (result?.ok) written.push(key);
  };

  await write("reviews.ingested_count", rows.length);

  const normalized: number[] = [];
  for (const row of rows) {
    const data = row.data as Record<string, unknown>;
    const rating = data["rating"];
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    const scale = typeof data["rating_scale"] === "number" && (data["rating_scale"] as number) > 0
      ? (data["rating_scale"] as number)
      : 5;
    normalized.push((rating / scale) * 5);
  }
  if (normalized.length > 0) {
    const avg = normalized.reduce((a, b) => a + b, 0) / normalized.length;
    await write("reviews.avg_rating", Math.round(avg * 100) / 100);
    const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const r of normalized) {
      const bucket = Math.min(5, Math.max(1, Math.round(r)));
      dist[String(bucket)] = (dist[String(bucket)] ?? 0) + 1;
    }
    await write("reviews.rating_distribution", dist);
  }

  const dates = rows
    .map((r) => normalizeDate((r.data as Record<string, unknown>)["date"]))
    .filter((d): d is string => d !== null)
    .sort();
  if (dates.length > 0) {
    await write("reviews.oldest_review_date", dates[0]);
    await write("reviews.newest_review_date", dates[dates.length - 1]);
  }
  return written;
}
