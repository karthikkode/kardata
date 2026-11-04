import { gunzipSync } from "node:zlib";
import { and, eq, inArray, like, or } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { blobs, documents, sources } from "../../db/schema.js";
import { pdfPageText, pdfReviewPages } from "../../lib/sec/pdf-text.js";
import { brochureKind, FEE_BROCHURE_PATH_PREFIX, FULL_BROCHURE_PATH } from "../ria-steps/brochure.js";
import { DomainError } from "../errors.js";
import { saveDocument } from "../research/documents.js";
import { isValidDateString } from "../research/validate.js";
import { feePrompt, groundFeeReview, summarizeFeeReview, type Passage } from "./fee-extraction.js";

export const ITEM_5_PATH = "financials/brochure-item-5.md";
const WINDOW_CHARS = 32_000;
const WINDOW_LIMIT = 24;
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
    const label = doc.path === FULL_BROCHURE_PATH || doc.path?.startsWith(FEE_BROCHURE_PATH_PREFIX)
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
    const prefix = `b-${sourceId}`;
    if (pages?.length) {
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
      continue;
    }
    if (pages) {
      gaps.push(`Original PDF for ${prefix} has no readable text; visual review required`);
      complete = false;
    } else if (!filings.some(f => f.path === FULL_BROCHURE_PATH && f.contentMd && f.contentMd.length < 120_000)) {
      gaps.push(`Only saved sections are available for ${prefix}`);
      complete = false;
    }
    const excerpts = filings.some(f => f.path === FULL_BROCHURE_PATH)
      ? filings.filter(f => f.path === FULL_BROCHURE_PATH) : filings;
    for (const [i, excerpt] of excerpts.entries()) {
      const text = excerpt.contentMd?.trim() ?? "";
      if (text.length >= 40 && !/^PDF retained for page review/.test(text)) {
        passages.push({ kind, ref: `${prefix}-s${i + 1}`, text, sourceId, page: null, documentId: excerpt.id, date: excerpt.date });
      }
    }
  }
  return { passages, complete, gaps, firmFound, sourceIds: [...retainedSources],
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

export async function reviewBrochures(passages: Passage[], coverage: { complete: boolean; gaps: string[] },
  call: (prompt: string) => Promise<unknown>) {
  const excerpts = splitPassages(passages);
  const windows: Passage[][] = [];
  let used = 0;
  for (const passage of excerpts) {
    if (!windows.length || used + passage.text.length > WINDOW_CHARS) { windows.push([]); used = 0; }
    windows.at(-1)!.push(passage);
    used += passage.text.length;
  }
  const allowed = windows.slice(0, WINDOW_LIMIT);
  const available = allowed.flat();
  const inventory = available.map(passage => passage.ref).join(", ");
  const preliminary: ReturnType<typeof groundFeeReview>[] = [];
  for (const window of allowed) {
    preliminary.push(groundFeeReview(await call(feePrompt(window, { stage: "read", inventory })), window));
  }
  const incomplete = windows.length > allowed.length;
  const gaps = [...coverage.gaps];
  if (incomplete) gaps.push(`${windows.length - allowed.length} review windows exceed the per-firm limit; original evidence retained`);
  const reviewed = { complete: coverage.complete && !incomplete, gaps,
    reviewedPages: new Set(available.filter(passage => passage.page !== null).map(p => `${p.sourceId}:${p.page}`)).size };

  // The reader can request other physical pages. All initial evidence is
  // retained, while the verifier gets grounded candidates and bounded
  // original excerpts around pricing or specific review requests.
  const requested = new Set(preliminary.flatMap(review => review.inspect));
  const original = [...available].sort((a, b) => Number(requested.has(b.ref)) - Number(requested.has(a.ref)) ||
    Number(/fees and compensation|fee schedule|\d\s*%/i.test(b.text)) - Number(/fees and compensation|fee schedule|\d\s*%/i.test(a.text)));
  const readOriginal = (preferred: Passage[]) => {
    const chosen: Passage[] = [];
    let remaining = WINDOW_CHARS;
    for (const passage of preferred) {
      if (passage.text.length > remaining) continue;
      chosen.push(passage);
      remaining -= passage.text.length;
    }
    return chosen;
  };
  const context = preliminary.map(({ schedules, terms, gaps, issues }) => ({ schedules, terms, gaps, issues }));
  const candidateJson: string[] = [];
  let candidateLength = 0;
  for (const value of context) {
    const json = JSON.stringify(value);
    if (candidateLength + json.length > WINDOW_CHARS) continue;
    candidateJson.push(json);
    candidateLength += json.length;
  }
  const prompt = (selected: Passage[]) => feePrompt(selected, {
    stage: "review", inventory, previous: candidateJson.join("\n"),
  });
  let selected = readOriginal(original);
  let result = groundFeeReview(await call(prompt(selected)), available);
  const newRefs = new Set(result.inspect.filter(ref => !selected.some(passage => passage.ref === ref)));
  if (available.some(passage => newRefs.has(passage.ref))) {
    selected = readOriginal([...original].sort((a, b) => Number(newRefs.has(b.ref)) - Number(newRefs.has(a.ref))));
    result = groundFeeReview(await call(prompt(selected)), available);
  }
  if (result.inspect.some(ref => !selected.some(passage => passage.ref === ref))) {
    reviewed.complete = false;
    gaps.push("The reviewing agent requested excerpts it did not receive within the review budget");
  }
  const findings = new Map([...preliminary.flatMap(read => read.findings), ...result.findings].map(finding =>
    [`${finding.evidence.ref}:${finding.evidence.quote}:${finding.topic}`, finding]));
  return summarizeFeeReview({ ...result, findings: [...findings.values()] }, preliminary, reviewed);
}
