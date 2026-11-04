import { gunzipSync } from "node:zlib";
import { and, eq, inArray, like, or } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { blobs, documents, sources } from "../../db/schema.js";
import { pdfPageText, pdfReviewPages } from "../../lib/sec/pdf-text.js";
import { brochureKind, brochureMarks, FEE_BROCHURE_PATH_PREFIX, FULL_BROCHURE_PATH } from "../ria-steps/brochure.js";
import { DomainError } from "../errors.js";
import { saveDocument } from "../research/documents.js";
import { isValidDateString } from "../research/validate.js";
import { feePrompt, groundFeeReview, summarizeFeeReview, type Passage } from "./fee-extraction.js";

export const ITEM_5_PATH = "financials/brochure-item-5.md";
const APPENDIX_REFERENCE = /(?:see|described in|refer to|provided in)\b[^.\n]{0,95}\b(?:appendix|wrap (?:fee )?brochure)\b/i;
const SEPARATE_WRAP_REFERENCE = /\b(?:separate wrap fee (?:program )?brochure|form adv part 2a appendix 1)\b/i;
export const needsWrapFiling = (item5: Passage[], passages: Passage[]) =>
  !passages.some(passage => passage.kind === "wrap") && item5.some(passage => SEPARATE_WRAP_REFERENCE.test(passage.text));
const WINDOW_CHARS = 26_000;
const MAX_ITEM_CHARS = 44_000;
const visualPath = (sourceId: string, page: number) => `financials/fee-visual-review/${sourceId}-${page}.md`;
const VISUAL_REVIEWER = "operator:fee-visual-review";

export async function saveBrochurePageReview(db: Db, input: { companyId: string; sourceId: string; page: number; text: string }) {
  const [source] = await db.select({ runId: sources.runId, gzip: blobs.gzip }).from(sources)
    .innerJoin(blobs, eq(sources.blobSha256, blobs.sha256)).where(and(
      eq(sources.id, input.sourceId), eq(sources.companyId, input.companyId),
    ));
  if (!source) throw new DomainError("not_found", "stored company brochure PDF not found");
  try { await pdfPageText(gunzipSync(source.gzip), input.page); }
  catch { throw new DomainError("invalid_input", "page is outside the stored PDF or the PDF cannot be opened"); }
  return saveDocument(db, {
    companyId: input.companyId, runId: source.runId, sourceIds: [input.sourceId],
    path: visualPath(input.sourceId, input.page), title: `Visually reviewed brochure page ${input.page}`,
    contentMd: input.text, createdBy: VISUAL_REVIEWER,
  });
}

export async function loadBrochureEvidence(db: Db, companyId: string) {
  const docs = (await db.select().from(documents).where(and(
    eq(documents.companyId, companyId), eq(documents.isCurrent, true),
    or(eq(documents.path, FULL_BROCHURE_PATH), like(documents.path, "financials/brochure-item-%"),
      like(documents.path, `${FEE_BROCHURE_PATH_PREFIX}%`)),
  ))).flatMap(doc => {
    const date = doc.title.match(/\b\d{4}-\d\d-\d\d\b/)?.[0];
    return date && isValidDateString(date) && doc.sourceIds?.length ? [{ ...doc, date }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date) || a.path!.localeCompare(b.path!) || a.id.localeCompare(b.id));
  const rows = await db.select({
    id: sources.id, collector: sources.collector, url: sources.url, blob: blobs.gzip,
  }).from(sources).leftJoin(blobs, eq(sources.blobSha256, blobs.sha256)).where(and(
    eq(sources.companyId, companyId), inArray(sources.id, [...new Set(docs.flatMap(doc => doc.sourceIds ?? []))]),
  ));
  const sourceMap = new Map(rows.map(row => [row.id, row]));
  const passages: Passage[] = [];
  const item5: Passage[] = [];
  const gaps: string[] = [];
  let firmFound = false;
  let complete = true;
  // Use roster entries plus the latest legacy filing. Legacy section docs
  // often share the same PDF and must not be read as separate brochures.
  const roster = docs.filter(doc => doc.path?.startsWith(FEE_BROCHURE_PATH_PREFIX));
  const rosterDate = roster[0]?.date;
  const legacyDate = docs.find(doc => !doc.path?.startsWith(FEE_BROCHURE_PATH_PREFIX))?.date;
  const selected = docs.filter(doc => doc.path?.startsWith(FEE_BROCHURE_PATH_PREFIX) ||
    (doc.date === legacyDate && (!rosterDate || doc.date >= rosterDate) &&
      !roster.some(entry => entry.date === doc.date && entry.title.includes("brochure firm"))));
  const bySource = new Map<string, typeof docs>();
  for (const doc of selected) {
    for (const sourceId of doc.sourceIds ?? []) {
      if (sourceMap.has(sourceId)) bySource.set(sourceId, [...bySource.get(sourceId) ?? [], doc]);
    }
  }
  const visual = new Map((await db.select().from(documents).where(and(
    eq(documents.companyId, companyId), eq(documents.isCurrent, true), eq(documents.createdBy, VISUAL_REVIEWER),
  ))).map(doc => [doc.path, doc]));
  const versions = new Set<string>();
  const retainedSources = new Set<string>();
  for (const [sourceId, filings] of bySource) {
    const source = sourceMap.get(sourceId)!;
    const doc = filings[0]!;
    const version = new URLSearchParams(source.url.split("?")[1]).get("BRCHR_VRSN_ID");
    if (version && versions.has(version)) continue;
    if (version) versions.add(version);
    let pages: string[] | undefined;
    if (source.blob) {
      const body = gunzipSync(source.blob);
      if (body.subarray(0, 5).toString("ascii") === "%PDF-") pages = await pdfReviewPages(body).catch(() => []);
    }
    const label = doc.path === ITEM_5_PATH || doc.path === FULL_BROCHURE_PATH || doc.path?.startsWith(FEE_BROCHURE_PATH_PREFIX)
      ? doc.title.replace(/SEC brochure firm/i, "firm brochure") : "";
    const coverReview = visual.get(visualPath(sourceId, 1));
    let kind = brochureKind(coverReview?.contentMd ?? (pages ? pages[0] ?? "" : filings.find(f => f.path === FULL_BROCHURE_PATH)?.contentMd ?? ""),
      source.collector === "sec_adv_brochure_archive" ? "Part 2A" : label);
    if (kind === "unknown" && pages?.some(page =>
      /^\s*(?:item\s+)?5[.:–—\s-]+fees and compensation\b/im.test(page))) kind = "firm";
    if (kind === "supplement") {
      gaps.push("Excluded a Part 2B personnel supplement");
      continue;
    }
    retainedSources.add(sourceId);
    if (kind === "firm") firmFound = true;
    const savedItem = filings.find(f => f.path === ITEM_5_PATH);
    const itemText = savedItem?.contentMd?.trim();
    const usableItem = savedItem && itemText && itemText.length >= 40 &&
      !/\.{5,}|PDF retained for page review/.test(itemText.slice(0, 400));
    const addSavedItem = () => {
      if (kind === "firm" && usableItem) item5.push({ kind, ref: `b-${sourceId}-item5`, text: itemText,
        sourceId, page: null, documentId: savedItem.id, date: savedItem.date });
    };
    const prefix = `b-${sourceId}`;
    if (pages?.length) {
      const first = passages.length;
      for (const [i, text] of pages.entries()) {
        const page = i + 1;
        const checked = visual.get(visualPath(sourceId, page));
        if (checked?.contentMd) {
          passages.push({ kind, ref: `${prefix}-v${page}`, text: checked.contentMd, sourceId, page, documentId: checked.id, date: doc.date });
        }
        if (!/[a-z]{3}/i.test(text)) {
          if (checked) continue;
          gaps.push(`No text layer on page ${i + 1} of ${prefix}; original PDF requires visual review`);
          complete = false;
          continue;
        }
        passages.push({ kind, ref: `${prefix}-p${i + 1}`, text, sourceId, page: i + 1, documentId: doc.id, date: doc.date });
      }
      if (kind === "firm") {
        const section = feeItemPassages(passages.slice(first));
        if (section.length) item5.push(...section);
        else addSavedItem();
      }
      continue;
    }
    if (pages) {
      gaps.push(`Original PDF for ${prefix} has no readable text; visual review required`);
      complete = false;
    } else if (!filings.some(f => f.path === FULL_BROCHURE_PATH && f.contentMd && f.contentMd.length < 120_000)) {
      gaps.push(`Only saved sections are available for ${prefix}`);
      complete = false;
    }
    const first = passages.length;
    const excerpts = filings.some(f => f.path === FULL_BROCHURE_PATH)
      ? filings.filter(f => f.path === FULL_BROCHURE_PATH) : filings;
    for (const [i, excerpt] of excerpts.entries()) {
      const text = excerpt.contentMd?.trim() ?? "";
      if (text.length >= 40 && !/^PDF retained for page review/.test(text)) {
        passages.push({ kind, ref: `${prefix}-s${i + 1}`, text, sourceId, page: null, documentId: excerpt.id, date: excerpt.date });
      }
    }
    if (kind === "firm") {
      const section = feeItemPassages(passages.slice(first));
      if (section.length) item5.push(...section);
      else addSavedItem();
    }
  }
  return { passages, item5, complete, gaps, firmFound, sourceIds: [...retainedSources],
    date: passages.map(p => p.date).sort().at(-1) };
}

function splitPassages(passages: Passage[]) {
  return passages.flatMap(passage => {
    if (passage.text.length <= WINDOW_CHARS) return [passage];
    const parts: Passage[] = [];
    let start = 0;
    while (start < passage.text.length) {
      const limit = start + WINDOW_CHARS;
      const line = passage.text.lastIndexOf("\n", limit);
      const end = limit < passage.text.length && line > start + WINDOW_CHARS / 2 ? line : limit;
      parts.push({ ...passage, ref: `${passage.ref}-${parts.length + 1}`, text: passage.text.slice(start, end) });
      if (end >= passage.text.length) break;
      start = end - 1600;
    }
    return parts;
  });
}

/** Locate Item 5 in the text layer, preserving its physical page citations. */
export function feeItemPassages(passages: Passage[]): Passage[] {
  const physical = passages.filter(passage => !/-v\d+$/.test(passage.ref));
  let offset = 0;
  const spans = physical.map(passage => {
    const span = { passage, start: offset, end: offset + passage.text.length };
    offset = span.end + 1;
    return span;
  });
  const text = physical.map(passage => passage.text).join("\n");
  const marks = brochureMarks(text);
  const heading = marks.find(mark => mark.item === "5");
  if (!heading) return [];
  const nextItem = /^[ \t]*(?:(?:item\s+)?[67][.:–—\s-]+(?:performance|types of clients)|(?:performance.based fees|types of clients)[ \t]*$)/im
    .exec(text.slice(heading.contentStart));
  const end = Math.min(marks.find(mark => mark.start > heading.start)?.start ?? text.length,
    nextItem ? heading.contentStart + nextItem.index : text.length);
  if (text.slice(heading.contentStart, end).trim().length < 40) return [];
  const chosen = spans.flatMap(({ passage, start, end: stop }) => {
    if (stop <= heading.start || start >= end) return [];
    return [{ ...passage, ref: `${passage.ref}-item5`,
      text: passage.text.slice(Math.max(0, heading.start - start), end - start) }];
  });
  return [...chosen, ...passages.filter(passage => /-v\d+$/.test(passage.ref) &&
    chosen.some(part => part.page === passage.page))];
}

type Review = ReturnType<typeof groundFeeReview>;
const hasPrice = (schedule: Review["schedules"][number]) => schedule.tiers.length > 0 || schedule.rateBounds !== null;
const unique = <T>(values: T[]) => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];

export function reconcileFeeReviews(initial: Review[], followups: Review[]) {
  const candidates = new Map<string, Review["schedules"][number]>();
  let sequence = 0;
  const add = (schedule: Review["schedules"][number]) => {
    const same = [...candidates.values()].some(candidate => candidate.scope.sourceId === schedule.scope.sourceId &&
      candidate.name.toLowerCase() === schedule.name.toLowerCase() && candidate.pricing === schedule.pricing &&
      JSON.stringify(candidate.tiers.map(t => [t.from, t.to, t.rate_pct])) ===
      JSON.stringify(schedule.tiers.map(t => [t.from, t.to, t.rate_pct])) &&
      candidate.rateBounds?.lower_pct === schedule.rateBounds?.lower_pct &&
      candidate.rateBounds?.upper_pct === schedule.rateBounds?.upper_pct);
    if (!same) candidates.set(`s${++sequence}`, schedule);
  };
  for (const review of initial) review.schedules.forEach(add);
  const drops: { candidate: string; schedule: string; reason: string; evidence: Review["decisions"][number]["evidence"] }[] = [];
  const corrections: typeof drops = [];
  const issues: string[] = [];
  for (const review of followups) {
    const replacementIndexes = new Set(review.decisions.flatMap(edit => edit.replacement === null ? [] : [edit.replacement]));
    for (const edit of review.decisions) {
      const existing = candidates.get(edit.candidate);
      if (!existing || edit.evidence.page === null || edit.evidence.sourceId !== existing.scope.sourceId) {
        issues.push("Schedule edit rejected without a cited physical page from the same filing");
        continue;
      }
      if (edit.action === "drop" && edit.replacement === null) {
        if ([existing.scope, existing.methodEvidence, ...existing.tiers.map(tier => tier.evidence)]
          .some(citation => citation?.quote === edit.evidence.quote)) {
          issues.push("Schedule drop rejected because its citation only repeats supporting evidence");
          continue;
        }
        candidates.delete(edit.candidate);
        drops.push({ candidate: edit.candidate, schedule: existing.name, reason: edit.reason, evidence: edit.evidence });
      } else if (edit.action === "correct" && edit.replacement !== null) {
        const replacement = review.schedules[edit.replacement];
        if (replacement?.scope.sourceId === existing.scope.sourceId && (!hasPrice(existing) || hasPrice(replacement))) {
          candidates.set(edit.candidate, { ...replacement, terms: unique([...replacement.terms, ...existing.terms]),
            conditions: unique([...replacement.conditions, ...existing.conditions]) });
          corrections.push({ candidate: edit.candidate, schedule: existing.name, reason: edit.reason, evidence: edit.evidence });
        } else issues.push("Schedule correction rejected because it would remove grounded pricing");
      }
    }
    review.schedules.forEach((schedule, i) => { if (!replacementIndexes.has(i)) add(schedule); });
  }
  const reads = [...initial, ...followups];
  return {
    candidates, drops, corrections,
    review: {
      schedules: [...candidates.values()], terms: unique(reads.flatMap(review => review.terms)),
      findings: unique(reads.flatMap(review => review.findings)),
      issues: unique([...issues, ...reads.flatMap(review => review.issues)]),
      gaps: unique(reads.flatMap(review => review.gaps)), inspect: [],
      needsFullDocument: false, decisions: [],
    } satisfies Review,
  };
}

function prioritizeFeePages(passages: Passage[], requested: Set<string>) {
  const score = (passage: Passage) => {
    const text = passage.text;
    return (requested.has(passage.ref) ? 100 : 0) +
      (/fees and compensation|fee schedule|annual (?:management|advisory|program) fee/i.test(text) ? 8 : 0) +
      (/\d\s*%/.test(text) && /fee|asset|portfolio/i.test(text) ? 4 : 0) +
      (/billing|minimum account|fees are|minimum annual/i.test(text) ? 2 : 0) +
      (passage.page === 1 ? 1 : 0);
  };
  const ordered = [...passages].sort((a, b) => score(b) - score(a));
  let remaining = WINDOW_CHARS;
  const refs = new Set<string>();
  for (const passage of ordered) {
    if (passage.text.length > remaining) continue;
    refs.add(passage.ref);
    remaining -= passage.text.length;
  }
  return passages.filter(passage => refs.has(passage.ref));
}

export async function reviewBrochures(passages: Passage[],
  coverage: { complete: boolean; gaps: string[]; item5?: Passage[] }, call: (prompt: string) => Promise<unknown>) {
  const full = splitPassages(passages);
  const primary = splitPassages(coverage.item5 ?? []);
  const inventory = unique([...primary, ...full].map(passage => passage.ref)).join(", ");
  const seen = new Map<string, Passage>();
  const read = async (excerpts: Passage[], stage: "read" | "review", previous?: unknown) => {
    for (const excerpt of excerpts) seen.set(excerpt.ref, excerpt);
    return groundFeeReview(await call(feePrompt(excerpts, { stage, inventory, previous })), excerpts);
  };

  const initial: Review[] = [];
  const followups: Review[] = [];
  const gaps = [...coverage.gaps];
  let complete = true;
  let window: Passage[] = [];
  let chars = 0;
  let consumed = 0;
  for (const passage of primary) {
    if (consumed + passage.text.length > MAX_ITEM_CHARS) {
      gaps.push("Item 5 exceeds the per-firm review budget");
      complete = false;
      break;
    }
    if (chars + passage.text.length > WINDOW_CHARS && window.length) {
      initial.push(await read(window, "read"));
      window = [];
      chars = 0;
    }
    window.push(passage);
    chars += passage.text.length;
    consumed += passage.text.length;
  }
  if (window.length) initial.push(await read(window, "read"));
  const appendix = primary.some(passage => APPENDIX_REFERENCE.test(passage.text) || SEPARATE_WRAP_REFERENCE.test(passage.text));
  const expand = !initial.length || !complete || appendix || initial.some(review => review.needsFullDocument ||
    review.schedules.some(schedule => schedule.invalidTierStarts.some(start => start === null || start <= 5_000_000)));
  if (expand) {
    const unread = primary.filter(passage => !seen.has(passage.ref));
    const requested = new Set([...initial.flatMap(review => review.inspect), ...unread.map(passage => passage.ref)]);
    const supplemental = [...unread, ...full.filter(passage => !primary.some(part =>
      part.sourceId === passage.sourceId && part.page !== null && part.page === passage.page &&
      part.text.trim() === passage.text.trim()))];
    const chosen = prioritizeFeePages(supplemental, requested);
    if (chosen.length) {
      const candidates = reconcileFeeReviews(initial, []).candidates;
      const previous = [...candidates].slice(0, 24).map(([id, schedule]) => ({
        id, name: schedule.name, pricing: schedule.pricing, page: schedule.scope.page,
        scope: schedule.scope.quote.slice(0, 200), rates: schedule.tiers.slice(0, 12).map(t => [t.from, t.to, t.rate_pct]),
      }));
      if (initial.length) followups.push(await read(chosen, "review", previous));
      else initial.push(await read(chosen, "read"));
    }
    if (!coverage.complete || chosen.length < supplemental.length) {
      complete = false;
      gaps.push("Full filing consulted for supplemental fee evidence within the review budget");
    }
  }
  const reconciled = reconcileFeeReviews(initial, followups);
  const reviewedPages = new Set([...seen.values()].filter(passage => passage.page !== null)
    .map(passage => `${passage.sourceId}:${passage.page}`)).size;
  return { ...summarizeFeeReview(reconciled.review, initial, { complete, gaps, reviewedPages }),
    drops: reconciled.drops, corrections: reconciled.corrections, readMode: expand ? "full_fallback" as const : "item_5" as const };
}
