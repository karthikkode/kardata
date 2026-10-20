import { and, eq, like } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { documents, researchRuns } from "../../db/schema.js";
import { recordEvent } from "../../collect/db.js";
import { saveDocument } from "./documents.js";

// Reviewer-style attribution: a first name plus an initial ("Sarah K."),
// within a short window of a review word ("review", "5 stars", "says"...).
const NAME_INITIAL = /\b([A-Z][a-z]{1,20})\s+([A-Z])\./g;
const REVIEW_WORDS =
  /\breview|\bratings?\b|\brated\b|\bstars?\b|\bverified\b|\btestimonials?\b|\bfeedback\b|\bsaid\b|\bsays\b|\bwrites?\b|\bwrote\b|\bcomment|\bquote|\breports?\b(?! to\b)/i;
const WINDOW = 80;

// First-name lookalikes that are never reviewer names.
const NON_NAMES = new Set(["vitamin", "type", "grade", "class", "group", "level", "stage", "phase", "step"]);

export const PII_REDACTED = "[redacted]";

export interface RedactResult {
  text: string;
  hits: number;
}

/** Replace reviewer-style attributions with [redacted]; returns the hit count. */
export function redactReviewerNames(input: string): RedactResult {
  let hits = 0;
  NAME_INITIAL.lastIndex = 0;
  const out: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  for (;;) {
    match = NAME_INITIAL.exec(input);
    if (match === null) break;
    const first = (match[1] ?? "").toLowerCase();
    const start = match.index;
    const end = start + match[0].length;
    const window = input.slice(Math.max(0, start - WINDOW), Math.min(input.length, end + WINDOW));
    if (!NON_NAMES.has(first) && REVIEW_WORDS.test(window)) {
      out.push(input.slice(cursor, start), PII_REDACTED);
      cursor = end;
      hits += 1;
    }
  }
  out.push(input.slice(cursor));
  return { text: out.join(""), hits };
}

export interface RedactedDoc {
  path: string;
  hits: number;
}

/**
 * Scan a run's current agent documents for reviewer attributions and redact
 * each hit in a new document version (created_by owner). Records one log
 * event per redacted doc so the scorecard can count hits.
 */
export async function redactRunDocs(db: Db, runId: string): Promise<RedactedDoc[]> {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) return [];
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.runId, runId), eq(documents.isCurrent, true), like(documents.createdBy, "agent:%")));
  const redacted: RedactedDoc[] = [];
  for (const doc of docs) {
    if (!doc.path) continue;
    const { text, hits } = redactReviewerNames(doc.contentMd ?? "");
    if (hits === 0) continue;
    await saveDocument(db, {
      companyId: run.companyId,
      runId,
      path: doc.path,
      kind: doc.kind ?? undefined,
      title: doc.title ?? undefined,
      contentMd: text,
      sourceIds: doc.sourceIds,
      factIds: doc.factIds,
      recordIds: doc.recordIds,
      tags: doc.tags,
      createdBy: "owner",
    });
    await recordEvent(db, runId, "log", { pii_redact: { path: doc.path, hits } });
    redacted.push({ path: doc.path, hits });
  }
  return redacted;
}
