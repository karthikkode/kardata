import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  areaStatuses,
  documents,
  facts,
  records,
  sources,
} from "../../db/schema.js";
import { checkPreflightGate } from "./preflight.js";
import { describeCompanyJob } from "./status.js";

/**
 * Research brief (Stage 5 Phase 6): the context block appended to a
 * research subjob's prompt, composed from the filed preflight report and
 * the collect subjob's outcome. Tells the agent what is already captured
 * so it researches the gaps instead of re-fetching.
 */

const REVIEW_LOCATION_MAX = 10;
const EVIDENCE_MAX = 200;
const NOTES_MAX = 500;
const SOURCE_LIST_MAX = 15;

function truncate(value: string | null, max: number): string {
  if (!value) return "";
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

async function countRows(db: Db, runId: string): Promise<{ sources: number; facts: number; records: number; documents: number }> {
  const [[s], [f], [r], [d]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(sources).where(eq(sources.runId, runId)),
    db.select({ n: sql<number>`count(*)` }).from(facts).where(eq(facts.runId, runId)),
    db.select({ n: sql<number>`count(*)` }).from(records).where(eq(records.lastSeenRunId, runId)),
    db.select({ n: sql<number>`count(*)` }).from(documents).where(eq(documents.runId, runId)),
  ]);
  return {
    sources: Number(s?.n ?? 0),
    facts: Number(f?.n ?? 0),
    records: Number(r?.n ?? 0),
    documents: Number(d?.n ?? 0),
  };
}

/** Compose the brief, or null when there is no valid report to brief from. */
export async function composeResearchBrief(db: Db, jobId: string): Promise<string | null> {
  const gate = await checkPreflightGate(db, jobId);
  if (!gate.ok) return null;
  const report = gate.report;
  const job = await describeCompanyJob(db, jobId);
  const collect = job.stages.find((s) => s.stage === "collect")?.run ?? null;

  const lines: string[] = [
    "## Pipeline context: what preflight and collect already found",
    "",
    `Preflight filed a collect plan (confidence ${report.confidence.toFixed(2)}).`,
  ];

  if (report.reviewLocations.length > 0) {
    lines.push("Review locations:");
    for (const loc of report.reviewLocations.slice(0, REVIEW_LOCATION_MAX)) {
      lines.push(`- ${loc.platform}: ${loc.url ?? "no URL"} — ${truncate(loc.evidence, EVIDENCE_MAX)}`);
    }
    if (report.reviewLocations.length > REVIEW_LOCATION_MAX) {
      lines.push(`- (+${report.reviewLocations.length - REVIEW_LOCATION_MAX} more)`);
    }
  } else {
    lines.push("Review locations: none found.");
  }
  if (report.adaptersRequired.length > 0) {
    lines.push(`Adapters used: ${report.adaptersRequired.map((a) => a.adapterId).join(", ")}.`);
  }
  if (report.adaptersMissing.length > 0) {
    lines.push(`Missing (not onboarded, not collected): ${report.adaptersMissing.map((m) => m.suggestedId).join(", ")}.`);
  }
  const directives = report.collectDirectives;
  if (directives.areas.length > 0 || directives.notes.trim() !== "") {
    lines.push(
      `Collect directives: areas ${directives.areas.length > 0 ? directives.areas.join(", ") : "all"}; ${truncate(directives.notes, NOTES_MAX)}`,
    );
  }
  if (report.notes.trim() !== "") lines.push(`Preflight notes: ${truncate(report.notes, NOTES_MAX)}`);

  if (!collect) {
    lines.push("Collect: not run yet.");
  } else {
    const finished = collect.finishedAt ? collect.finishedAt.toISOString() : "unfinished";
    lines.push(`Collect: ${collect.status} at ${finished}.`);
    const areas = await db
      .select()
      .from(areaStatuses)
      .where(eq(areaStatuses.runId, collect.id))
      .orderBy(areaStatuses.area);
    if (areas.length > 0) {
      lines.push(
        `Areas: ${areas.map((a) => (a.status === "done" ? `${a.area}: done` : `${a.area}: ${a.status} (${truncate(a.reason, 120)})`)).join("; ")}.`,
      );
    }
    const counts = await countRows(db, collect.id);
    lines.push(
      `Collect captured: ${counts.sources} sources, ${counts.facts} facts, ${counts.records} records, ${counts.documents} documents.`,
    );
    const captured = await db
      .select({
        collector: sources.collector,
        finalUrl: sources.finalUrl,
        status: sources.status,
      })
      .from(sources)
      .where(eq(sources.runId, collect.id))
      .orderBy(desc(sources.fetchedAt))
      .limit(SOURCE_LIST_MAX + 1);
    if (captured.length > 0) {
      lines.push("Already captured (build on these, don't re-fetch):");
      for (const s of captured.slice(0, SOURCE_LIST_MAX)) {
        lines.push(`- [${s.collector}] ${s.finalUrl} (${s.status})`);
      }
      if (captured.length > SOURCE_LIST_MAX) lines.push(`- (+${counts.sources - SOURCE_LIST_MAX} more)`);
    }
  }
  lines.push("Research the gaps; verify thin claims against fresh sources.");
  return lines.join("\n");
}
