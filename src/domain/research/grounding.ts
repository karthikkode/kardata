import { and, eq, like } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { documents, facts, records, sources, type Fact } from "../../db/schema.js";
import { blobText } from "./reads.js";

/**
 * Post-extraction grounding check (Stage 4.2). For every extractor-written
 * fact value and record field that is a number, a date or a short string
 * (<= 60 chars), look for it — normalized — in the text of its cited
 * sources, else in the agent-document lines carrying that source (its id
 * or URL; agents cite inline URLs more often than [src:id]).
 * Verdicts are stored, never dropped: verified | doc_only | unverified.
 */

export type GroundVerdict = "verified" | "doc_only" | "unverified";

export interface GroundCounts {
  verified: number;
  docOnly: number;
  unverified: number;
}

export const SHORT_STRING_MAX = 60;

type Checkable =
  | { kind: "number"; num: number }
  | { kind: "date"; iso: string }
  | { kind: "string"; text: string };

const CURRENCY = "$€£¥₹₩₪₽¢";
const NUMBER_TOKEN = new RegExp(`[${CURRENCY}]?\\s*\\d[\\d,]*\\.?\\d*\\s*(%|percent|k|m|b|thousand|million|billion)?`, "gi");

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''’`´]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberTokens(text: string): number[] {
  const out: number[] = [];
  NUMBER_TOKEN.lastIndex = 0;
  for (let m = NUMBER_TOKEN.exec(text); m !== null; m = NUMBER_TOKEN.exec(text)) {
    const raw = m[0].replace(/[$€£¥₹₩₪₽¢,\s%]/g, "").replace(/(percent|thousand|million|billion|k|m|b)$/i, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const suffix = /percent|%/i.test(m[0]) ? 1 : /b(illion)?$/i.test(m[0]) ? 1e9 : /m(illion)?$/i.test(m[0]) ? 1e6 : /k$/i.test(m[0]) || /thousand$/i.test(m[0]) ? 1e3 : 1;
    out.push(n * suffix);
  }
  return out;
}

export function numberInText(value: number, text: string): boolean {
  if (!Number.isFinite(value)) return false;
  return numberTokens(text).some((n) => Math.abs(n - value) <= Math.abs(value) * 1e-9 + 1e-9);
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Normalized renderings of an ISO date to look for in source text. */
export function dateVariants(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return [];
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const month = MONTHS[Number(mo) - 1] ?? "";
  const day = String(Number(d));
  const variants = [
    `${y}-${mo}-${d}`,
    `${y}/${mo}/${d}`,
    `${month} ${day} ${y}`,
    `${month.slice(0, 3)} ${day} ${y}`,
    `${day} ${month} ${y}`,
    `${day} ${month.slice(0, 3)} ${y}`,
    `${Number(mo)}/${day}/${y}`,
    `${day}/${Number(mo)}/${y}`,
  ];
  return [...new Set(variants.map(normalizeText))];
}

export function stringInText(value: string, text: string): boolean {
  const needle = normalizeText(value);
  if (needle === "") return false;
  return normalizeText(text).includes(needle);
}

// Extractors emit ISO codes while sources show symbols; treat them as equal.
const CODE_SYMBOLS: Record<string, string[]> = {
  USD: ["$"],
  EUR: ["€"],
  GBP: ["£"],
  JPY: ["¥"],
  CNY: ["¥", "元"],
  INR: ["₹"],
  KRW: ["₩"],
  AUD: ["A$"],
  CAD: ["C$"],
};

function currencyInText(code: string, text: string): boolean {
  if (stringInText(code, text)) return true;
  const symbols = CODE_SYMBOLS[code.trim().toUpperCase()] ?? [];
  return symbols.some((s) => text.includes(s));
}

function checkableInText(c: Checkable, text: string): boolean {
  if (c.kind === "number") return numberInText(c.num, text);
  if (c.kind === "date") {
    const hay = normalizeText(text);
    return dateVariants(c.iso).some((v) => v !== "" && hay.includes(v));
  }
  if (/^[a-z]{3}$/i.test(c.text.trim())) return currencyInText(c.text, text);
  return stringInText(c.text, text);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function moneyCheckables(value: unknown): Checkable[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const obj = value as Record<string, unknown>;
  if (typeof obj.amount !== "number") return [];
  const out: Checkable[] = [{ kind: "number", num: obj.amount }];
  if (typeof obj.currency === "string" && obj.currency.trim() !== "") {
    out.push({ kind: "string", text: obj.currency });
  }
  return out;
}

function scalarCheckable(value: unknown): Checkable | null {
  if (typeof value === "number" && Number.isFinite(value)) return { kind: "number", num: value };
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (ISO_DATE.test(trimmed)) return { kind: "date", iso: trimmed };
  // Numeric-looking strings match as numbers ("1,234", "$25", "4.5").
  if (/^[$€£¥₹₩₪₽¢\s\d,]*\.?\d+\s*%?$/.test(trimmed) && /\d/.test(trimmed)) {
    const n = Number(trimmed.replace(/[$€£¥₹₩₪₽¢,\s%]/g, ""));
    if (Number.isFinite(n)) return { kind: "number", num: n };
  }
  if (trimmed.length <= SHORT_STRING_MAX) return { kind: "string", text: trimmed };
  return null;
}

/** Checkable values of one fact row: number, date, short text, money. */
export function factCheckables(fact: Pick<Fact, "valueNum" | "valueText" | "valueDate" | "valueBool" | "valueJson">): Checkable[] {
  if (fact.valueNum !== null && fact.valueNum !== undefined) {
    const n = Number(fact.valueNum);
    if (Number.isFinite(n)) return [{ kind: "number", num: n }];
  }
  if (fact.valueDate !== null && fact.valueDate !== undefined) {
    const iso = typeof fact.valueDate === "string" ? fact.valueDate.slice(0, 10) : null;
    if (iso && ISO_DATE.test(iso)) return [{ kind: "date", iso }];
  }
  if (fact.valueText !== null && fact.valueText !== undefined) {
    const c = scalarCheckable(fact.valueText);
    if (c) return [c];
    return [];
  }
  if (fact.valueJson !== null && fact.valueJson !== undefined) {
    const money = moneyCheckables(fact.valueJson);
    if (money.length > 0) return money;
    if (Array.isArray(fact.valueJson)) {
      return fact.valueJson
        .map((v) => scalarCheckable(v))
        .filter((c): c is Checkable => c !== null);
    }
  }
  return [];
}

/** Checkable values of one record data object, field by field. */
export function recordCheckables(data: Record<string, unknown>): Checkable[] {
  const out: Checkable[] = [];
  for (const value of Object.values(data)) {
    const money = moneyCheckables(value);
    if (money.length > 0) {
      out.push(...money);
      continue;
    }
    const c = scalarCheckable(value);
    if (c) out.push(c);
  }
  return out;
}

type ValueHit = "source" | "doc" | "none";

function verdictFor(hits: ValueHit[], checkableCount: number): GroundVerdict {
  if (checkableCount === 0) return "unverified";
  if (hits.every((h) => h === "source")) return "verified";
  if (hits.every((h) => h !== "none")) return "doc_only";
  return "unverified";
}

interface CitedSource {
  text: string;
  urls: string[];
}

function urlVariants(url: string): string[] {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed === "") return [];
  const out = [trimmed];
  const noscheme = trimmed.replace(/^https?:\/\//i, "");
  if (noscheme !== trimmed) out.push(noscheme);
  const nowww = noscheme.replace(/^www\./i, "");
  if (nowww !== noscheme) out.push(nowww);
  return [...new Set(out)];
}

async function citedSources(
  db: Db,
  sourceIds: string[],
  cache: Map<string, CitedSource>,
): Promise<CitedSource[]> {
  const out: CitedSource[] = [];
  for (const id of sourceIds) {
    if (!cache.has(id)) {
      const [row] = await db
        .select({ url: sources.url, finalUrl: sources.finalUrl, blobSha256: sources.blobSha256 })
        .from(sources)
        .where(eq(sources.id, id));
      let text = "";
      if (row?.blobSha256) {
        try {
          text = (await blobText(db, row.blobSha256))?.text ?? "";
        } catch {
          text = "";
        }
      }
      cache.set(id, {
        text,
        urls: row ? [...urlVariants(row.url), ...urlVariants(row.finalUrl)] : [],
      });
    }
    out.push(cache.get(id) ?? { text: "", urls: [] });
  }
  return out;
}

/**
 * Verify every extractor-written fact and record of one run. Updates the
 * verification column in place and returns the counts. Never drops rows.
 */
export async function verifyRunExtraction(db: Db, runId: string): Promise<GroundCounts & { total: number }> {
  const counts: GroundCounts & { total: number } = { verified: 0, docOnly: 0, unverified: 0, total: 0 };
  const [factRows, recordRows, docRows] = await Promise.all([
    db
      .select()
      .from(facts)
      .where(and(eq(facts.runId, runId), like(facts.createdBy, "extractor:%"))),
    db
      .select()
      .from(records)
      .where(and(eq(records.lastSeenRunId, runId), like(records.createdBy, "extractor:%"))),
    db
      .select({ contentMd: documents.contentMd })
      .from(documents)
      .where(and(eq(documents.runId, runId), eq(documents.isCurrent, true))),
  ]);
  const docLines = docRows.flatMap((d) => d.contentMd.split("\n"));
  const cache = new Map<string, CitedSource>();

  const check = async (checkables: Checkable[], sourceIds: string[]): Promise<GroundVerdict> => {
    if (checkables.length === 0) return "unverified";
    const cited = await citedSources(db, sourceIds, cache);
    const texts = cited.map((c) => c.text).filter((t) => t !== "");
    const markers = [...sourceIds, ...cited.flatMap((c) => c.urls)];
    const lines = markers.length === 0 ? [] : docLines.filter((l) => markers.some((m) => l.includes(m)));
    const hits: ValueHit[] = checkables.map((c) => {
      if (texts.some((t) => checkableInText(c, t))) return "source";
      if (lines.some((l) => checkableInText(c, l))) return "doc";
      return "none";
    });
    return verdictFor(hits, checkables.length);
  };

  for (const fact of factRows) {
    counts.total += 1;
    const verdict = await check(factCheckables(fact), fact.sourceIds);
    await db.update(facts).set({ verification: verdict }).where(eq(facts.id, fact.id));
    if (verdict === "verified") counts.verified += 1;
    else if (verdict === "doc_only") counts.docOnly += 1;
    else counts.unverified += 1;
  }
  for (const record of recordRows) {
    counts.total += 1;
    const verdict = await check(recordCheckables(record.data), record.sourceIds);
    await db.update(records).set({ verification: verdict }).where(eq(records.id, record.id));
    if (verdict === "verified") counts.verified += 1;
    else if (verdict === "doc_only") counts.docOnly += 1;
    else counts.unverified += 1;
  }
  return counts;
}
