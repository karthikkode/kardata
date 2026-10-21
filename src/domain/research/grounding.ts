import { and, eq, like } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { documents, facts, findings, records, sources, type Fact } from "../../db/schema.js";
import { blobText } from "./reads.js";

/**
 * Quote grounding (Stage 4.3). Every extractor-written fact, record and
 * finding carries a verbatim `quote` (<= 300 chars, copied from the provided
 * text) plus the `quote_source_id` it comes from. The server checks the
 * quote — normalized for whitespace, quotes/dashes and case — against that
 * source's stored text, else against the run's current agent documents. No
 * citation link is required for doc_only: v1.2 agents cite sparsely (Wolf:
 * 22 of 298 doc lines carry any marker), so gating on the link would fail
 * genuine agent prose; the verbatim match plus value consistency is the
 * grounding, and quote_source_id stays as provenance metadata. Verdicts are
 * stored, never dropped: verified | doc_only | quote_mismatch | unverified
 * (no quote).
 */

export type GroundVerdict = "verified" | "doc_only" | "quote_mismatch" | "unverified" | "verified_value";

export interface GroundCounts {
  verified: number;
  docOnly: number;
  mismatch: number;
  unverified: number;
  verifiedValue: number;
}

export const SHORT_STRING_MAX = 60;

type Checkable =
  | { kind: "number"; num: number }
  | { kind: "date"; iso: string }
  | { kind: "string"; text: string };

const CURRENCY_SYMBOLS = "$€£¥₹₩₪₽¢";

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''’`´]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase; unify quotes and dashes; collapse whitespace. Keeps word shape. */
export function normalizeQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″"]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeQuote(quote);
  if (q === "") return false;
  return normalizeQuote(text).includes(q);
}

/**
 * Parse one localized number: EU/US decimals ("80,00" / "80.00"), thousands
 * separators (",", ".", space, "'"), with the last of dot/comma winning when
 * both are present. A lone comma is a decimal comma with 1-2 decimals
 * ("80,00", "1,5") and a thousands separator otherwise ("1,234"). A lone dot
 * is always a decimal point (US-biased corpus).
 */
export function parseLocalizedNumber(raw: string): number | null {
  let s = raw.trim().replace(/[\s']/g, "").replace(/[.,]+$/, "");
  if (s === "") return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    if (s.lastIndexOf(".") > s.lastIndexOf(",")) s = s.replace(/,/g, "");
    else s = s.replace(/\./g, "").replace(/,/g, ".");
  } else if (hasComma) {
    if (/,\d{1,2}$/.test(s)) s = s.replace(/,/g, ".");
    else s = s.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SCALE_WORDS: [RegExp, number][] = [
  [/(thousand)/i, 1e3],
  [/(million)/i, 1e6],
  [/(billion)/i, 1e9],
];

function scaleOf(suffix: string): number {
  const s = suffix.trim().toLowerCase();
  if (s === "") return 1;
  if (/^k$/.test(s)) return 1e3;
  if (/^m$/.test(s)) return 1e6;
  if (/^b$/.test(s)) return 1e9;
  for (const [re, scale] of SCALE_WORDS) {
    if (re.test(s)) return scale;
  }
  return 1;
}

interface NumberToken {
  value: number;
  percent: boolean;
}

const TOKEN_RE = new RegExp(
  `[${CURRENCY_SYMBOLS}]?\\s*(?:(?<!\\d)-)?\\d[\\d.,']*\\d?\\s*(%|percent\\b|k\\b|m\\b|b\\b|thousands?\\b|millions?\\b|billions?\\b)?`,
  "gi",
);

// Space thousands ("93 000 €") merge only before currency, % or punctuation
// — never between bare numbers ("100 200" stays two numbers).
const SPACE_THOUSANDS = new RegExp(`(\\d) (?=\\d{3}\\s*[${CURRENCY_SYMBOLS}%.,;:!?)\\]}])`, "g");

/** Numeric tokens of a text, with percent flags. Ranges expand to endpoints. */
function numberTokens(text: string): NumberToken[] {
  const merged = text.replace(SPACE_THOUSANDS, "$1");
  const out: NumberToken[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(merged); m !== null; m = TOKEN_RE.exec(merged)) {
    const raw = m[0].replace(new RegExp(`[${CURRENCY_SYMBOLS}\\s]`, "g"), "");
    const suffix = /(%|percent|k|m|b|thousands?|millions?|billions?)$/i.exec(raw)?.[1] ?? "";
    const numPart = suffix === "" ? raw : raw.slice(0, raw.length - suffix.length);
    const n = parseLocalizedNumber(numPart);
    if (n === null) continue;
    const percent = /^(%|percent)$/i.test(suffix);
    out.push({ value: n * (percent ? 1 : scaleOf(suffix)), percent });
  }
  return out;
}

const RANGE_RE = /(\d[\d.,\s']*)\s*(–|—|-|−|\bto\b)\s*(\d[\d.,\s']*)/gi;

/** True when the value falls inside any numeric range in the text. ISO dates are not ranges. */
function numberInRange(value: number, text: string): boolean {
  RANGE_RE.lastIndex = 0;
  for (let m = RANGE_RE.exec(text); m !== null; m = RANGE_RE.exec(text)) {
    const a = parseLocalizedNumber(m[1] ?? "");
    const b = parseLocalizedNumber(m[3] ?? "");
    if (a === null || b === null) continue;
    // YYYY-MM followed by -DD is an ISO date, not a range.
    if (/^\d{4}$/.test((m[1] ?? "").trim())) {
      const after = text.slice((m.index ?? 0) + m[0].length);
      if (/^\s*-\s*\d{1,2}\b/.test(after)) continue;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (value >= lo && value <= hi) return true;
  }
  return false;
}

function numEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-9;
}

export function numberInText(value: number, text: string): boolean {
  if (!Number.isFinite(value)) return false;
  for (const token of numberTokens(text)) {
    if (numEq(token.value, value)) return true;
    // Percent-aware: 0.25 matches "25%", and 25 matches "25%".
    if (token.percent && numEq(token.value, value * 100)) return true;
  }
  return numberInRange(value, text);
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

/** A numeric token with an optional scale suffix and trailing words. */
const NUMERIC_PHRASE = /^(-?\d[\d.,']*\d?|-?\d)\s*(%|percent|k|m|b|thousands?|millions?|billions?)?\s*(.*)$/i;

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

/**
 * Checkable parts of one scalar: numbers (EU/US forms, units, currency)
 * split into number + currency/unit words ("100 employees", "$25"), ISO
 * dates as dates, other short strings verbatim. Booleans, long text and
 * non-money objects are not checkable — the quote match alone grounds them.
 */
function scalarCheckables(value: unknown): Checkable[] {
  if (typeof value === "number" && Number.isFinite(value)) return [{ kind: "number", num: value }];
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (trimmed === "") return [];
  if (ISO_DATE.test(trimmed)) return [{ kind: "date", iso: trimmed }];
  // Strip one surrounding currency symbol ("$25", "80,00 €") and split off
  // one leading 3-letter code ("USD 25") before the numeric parse.
  const desymbolized = trimmed
    .replace(new RegExp(`^[${CURRENCY_SYMBOLS}]\\s*`), "")
    .replace(new RegExp(`\\s*[${CURRENCY_SYMBOLS}]$`), "");
  let head = desymbolized;
  let leadCode = "";
  const lead = /^([A-Za-z]{3})\s+(.+)$/.exec(head);
  if (lead && lead[1] && lead[2]) {
    leadCode = lead[1];
    head = lead[2];
  }
  const phrase = NUMERIC_PHRASE.exec(head);
  if (phrase) {
    const n = parseLocalizedNumber(phrase[1] ?? "");
    if (n !== null) {
      const out: Checkable[] = [{ kind: "number", num: n * scaleOf(phrase[2] ?? "") }];
      if (leadCode !== "") out.push({ kind: "string", text: leadCode });
      const rest = (phrase[3] ?? "").trim();
      if (rest !== "" && rest.length <= SHORT_STRING_MAX) out.push({ kind: "string", text: rest });
      return out;
    }
  }
  if (trimmed.length <= SHORT_STRING_MAX) return [{ kind: "string", text: trimmed }];
  return [];
}

/** Value kind of one fact row, for per-kind verification shares. */
export type FactValueKind = "number" | "money" | "date" | "short_text" | "bool" | "long_text" | "json";

export function factValueKind(
  fact: Partial<Pick<Fact, "valueNum" | "valueText" | "valueDate" | "valueBool" | "valueJson">>,
): FactValueKind {
  if (fact.valueNum !== null && fact.valueNum !== undefined) {
    const n = Number(fact.valueNum);
    if (Number.isFinite(n)) return "number";
  }
  if (fact.valueDate !== null && fact.valueDate !== undefined) {
    const iso = typeof fact.valueDate === "string" ? fact.valueDate.slice(0, 10) : null;
    if (iso && ISO_DATE.test(iso)) return "date";
  }
  if (fact.valueText !== null && fact.valueText !== undefined) {
    return fact.valueText.trim().length <= SHORT_STRING_MAX ? "short_text" : "long_text";
  }
  if (fact.valueBool !== null && fact.valueBool !== undefined) return "bool";
  if (fact.valueJson !== null && fact.valueJson !== undefined) {
    return moneyCheckables(fact.valueJson).length > 0 ? "money" : "json";
  }
  return "json";
}

/** Checkable values of one fact row: number, date, short text, money. */
export function factCheckables(fact: Partial<Pick<Fact, "valueNum" | "valueText" | "valueDate" | "valueBool" | "valueJson">>): Checkable[] {
  if (fact.valueNum !== null && fact.valueNum !== undefined) {
    const n = Number(fact.valueNum);
    if (Number.isFinite(n)) return [{ kind: "number", num: n }];
  }
  if (fact.valueDate !== null && fact.valueDate !== undefined) {
    const iso = typeof fact.valueDate === "string" ? fact.valueDate.slice(0, 10) : null;
    if (iso && ISO_DATE.test(iso)) return [{ kind: "date", iso }];
  }
  if (fact.valueText !== null && fact.valueText !== undefined) {
    return scalarCheckables(fact.valueText);
  }
  if (fact.valueJson !== null && fact.valueJson !== undefined) {
    const money = moneyCheckables(fact.valueJson);
    if (money.length > 0) return money;
    if (Array.isArray(fact.valueJson)) {
      return fact.valueJson.flatMap((v) => scalarCheckables(v));
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
    out.push(...scalarCheckables(value));
  }
  return out;
}

const URL_VALUE = /^https?:\/\//i;

/** Number/date/money checkables of one record data object (URL fields skipped). */
export function recordHardCheckables(data: Record<string, unknown>): Checkable[] {
  const out: Checkable[] = [];
  for (const value of Object.values(data)) {
    if (typeof value === "string" && URL_VALUE.test(value.trim())) continue;
    const money = moneyCheckables(value);
    if (money.length > 0) {
      out.push(...money);
      continue;
    }
    for (const c of scalarCheckables(value)) {
      if (c.kind !== "string") out.push(c);
    }
  }
  return out;
}

/**
 * Record hard claims hold in the given grounding text. String labels are
 * the extractor's synthesis (theme names, tier words) and are never
 * verifiable lexically, so only numbers, dates and money count.
 */
export function recordHardConsistent(data: Record<string, unknown>, text: string): boolean {
  return recordHardCheckables(data).every((c) => checkableInText(c, text));
}

/** Fact consistency with a matched quote: every checkable must hold (atomic claims). */
export function factConsistent(
  fact: Partial<Pick<Fact, "valueNum" | "valueText" | "valueDate" | "valueBool" | "valueJson">>,
  quote: string,
): boolean {
  return factCheckables(fact).every((c) => checkableInText(c, quote));
}

interface CitedSource {
  text: string;
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
      cache.set(id, { text });
    }
    out.push(cache.get(id) ?? { text: "" });
  }
  return out;
}

export interface QuoteItem {
  quote: string | null;
  quoteSourceId: string | null;
  /**
   * Consistency of the item's value. Facts check every checkable against
   * the quote itself (atomic claims); records check hard claims against a
   * grounding text; findings always pass.
   */
  isConsistent: (text: string) => boolean;
  /** Records check hard claims against the full grounding material. */
  consistencyText?: "quote" | "material";
}

/**
 * One item's verdict: no quote means unverified; a quote found in the quote
 * source's text means verified when the value is consistent; a quote found
 * only in the run's agent documents means doc_only. Anything else is a
 * quote_mismatch. Records additionally downgrade to doc_only when their
 * hard claims hold only in the documents rather than the quote's source.
 */
export async function verifyQuote(
  db: Db,
  item: QuoteItem,
  docTexts: string[],
  cache: Map<string, CitedSource>,
): Promise<GroundVerdict> {
  const quote = (item.quote ?? "").trim();
  if (quote === "" || !item.quoteSourceId) return "unverified";
  const [cited] = await citedSources(db, [item.quoteSourceId], cache);
  const sourceText = cited?.text ?? "";
  const material = docTexts.length > 0 ? `${sourceText}\n${docTexts.join("\n")}` : sourceText;
  const text = item.consistencyText === "material" ? material : quote;
  const inSource = quoteInText(quote, sourceText);
  const inDoc = !inSource && docTexts.some((t) => quoteInText(quote, t));
  if (!inSource && !inDoc) return "quote_mismatch";
  if (!item.isConsistent(text)) return "quote_mismatch";
  if (item.consistencyText === "material") {
    // Records: fully source-grounded only when the hard claims hold there.
    if (inSource && item.isConsistent(sourceText)) return "verified";
    return "doc_only";
  }
  return inSource ? "verified" : "doc_only";
}

/**
 * Verify every extractor-written fact, record and finding of one run.
 * Updates the verification column in place and returns the counts. Never
 * drops rows.
 */
export async function verifyRunExtraction(db: Db, runId: string): Promise<GroundCounts & { total: number }> {
  const counts: GroundCounts & { total: number } = {
    verified: 0,
    docOnly: 0,
    mismatch: 0,
    unverified: 0,
    verifiedValue: 0,
    total: 0,
  };
  const [factRows, recordRows, findingRows, docRows] = await Promise.all([
    db
      .select()
      .from(facts)
      .where(and(eq(facts.runId, runId), like(facts.createdBy, "extractor:%"))),
    db
      .select()
      .from(records)
      .where(and(eq(records.lastSeenRunId, runId), like(records.createdBy, "extractor:%"))),
    db
      .select()
      .from(findings)
      .where(and(eq(findings.runId, runId), like(findings.createdBy, "extractor:%"))),
    db
      .select({ contentMd: documents.contentMd, sourceIds: documents.sourceIds })
      .from(documents)
      .where(
        and(
          eq(documents.runId, runId),
          eq(documents.isCurrent, true),
          like(documents.createdBy, "agent:%"),
        ),
      ),
  ]);
  const docTexts = docRows.map((d) => d.contentMd);
  const cache = new Map<string, CitedSource>();

  const tally = (verdict: GroundVerdict): void => {
    counts.total += 1;
    if (verdict === "verified") counts.verified += 1;
    else if (verdict === "doc_only") counts.docOnly += 1;
    else if (verdict === "quote_mismatch") counts.mismatch += 1;
    else if (verdict === "verified_value") counts.verifiedValue += 1;
    else counts.unverified += 1;
  };

  // Stage 5.1: a doc_only item whose value is found (normalized) in its
  // cited sources' text is grounded after all — label it verified_value.
  // Findings have no checkable value, so they never upgrade.
  const maybeUpgrade = async (
    verdict: GroundVerdict,
    checkables: Checkable[],
    sourceIds: string[],
  ): Promise<GroundVerdict> => {
    if (verdict !== "doc_only" || checkables.length === 0) return verdict;
    const texts = (await citedSources(db, sourceIds, cache)).map((s) => s.text).join("\n");
    return checkables.every((c) => checkableInText(c, texts)) ? "verified_value" : "doc_only";
  };

  for (const fact of factRows) {
    const quoted = await verifyQuote(
      db,
      {
        quote: fact.quote,
        quoteSourceId: fact.quoteSourceId,
        isConsistent: (q) => factConsistent(fact, q),
      },
      docTexts,
      cache,
    );
    const verdict = await maybeUpgrade(quoted, factCheckables(fact), fact.sourceIds);
    await db.update(facts).set({ verification: verdict }).where(eq(facts.id, fact.id));
    tally(verdict);
  }
  for (const record of recordRows) {
    const quoted = await verifyQuote(
      db,
      {
        quote: record.quote,
        quoteSourceId: record.quoteSourceId,
        isConsistent: (t) => recordHardConsistent(record.data, t),
        consistencyText: "material",
      },
      docTexts,
      cache,
    );
    const verdict = await maybeUpgrade(quoted, recordHardCheckables(record.data), record.sourceIds);
    await db.update(records).set({ verification: verdict }).where(eq(records.id, record.id));
    tally(verdict);
  }
  for (const finding of findingRows) {
    const verdict = await verifyQuote(
      db,
      { quote: finding.quote, quoteSourceId: finding.quoteSourceId, isConsistent: () => true },
      docTexts,
      cache,
    );
    await db.update(findings).set({ verification: verdict }).where(eq(findings.id, finding.id));
    tally(verdict);
  }
  return counts;
}
