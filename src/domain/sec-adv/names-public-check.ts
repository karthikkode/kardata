import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { records } from "../../db/schema.js";
import { fetchUrl } from "../../collect/fetch.js";
import { SEC_FIRM_USER_AGENT } from "../../collect/collectors/sec-firm.js";
import { pdfTextAndItems } from "../../lib/sec/pdf-text.js";
import { parseScheduleA } from "../../lib/sec/schedule-a.js";
import { isContactName } from "../../lib/contact-name.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import { findEvidenceLibrary } from "../evidence-library.js";
import { DomainError } from "../errors.js";
import { upsertRecords } from "../research/records.js";
import { filingPeople, FILING_NAMES_STATUS, FILING_PEOPLE, formatFiledName } from "./contact-people.js";
import { companyFileEvidence } from "./evidence.js";
import { ownerNamesMembers } from "./owner-names.js";

const COLLECTOR = "sec_schedule_a_public_check";
const MANIFEST = "https://reports.adviserinfo.sec.gov/reports/CompilationReports/CompilationReports.manifest.json";
const key = (name: string) => formatFiledName(name).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** No alternative host, proxy or browser fallback when SEC denies access. */
export async function checkNamesPublic(db: Db, input: { sectorId: string; companyIds?: string[]; markArchiveGaps?: boolean }) {
  const members = await ownerNamesMembers(db, input.sectorId);
  if (input.markArchiveGaps) {
    if (input.companyIds) throw new DomainError("invalid_input", "choose archive-gap check or named spot checks");
    const library = await findEvidenceLibrary(db);
    if (!library) throw new DomainError("invalid_input", "run evidence_library_ensure first");
    const fetched = await fetchUrl(db, { companyId: library.companyId, runId: await getOrCreateManualRun(db, library.companyId),
      collector: COLLECTOR, url: MANIFEST, userAgent: SEC_FIRM_USER_AGENT, strictRobots: true,
      redirectHost: "reports.adviserinfo.sec.gov" });
    const available = fetched.source.status === "ok" && !!fetched.body;
    // A reachable manifest is reported for normal archive download/import; never pretend a block proves no filing exists.
    if (available) return { available: true, sourceId: fetched.source.id, manifest: fetched.text ?? fetched.body?.toString("utf8"), marked: 0 };
    let marked = 0;
    for (let offset = 0; offset < members.length; offset += 500) {
      const gaps = await db.select().from(records).where(and(inArray(records.companyId, members.slice(offset, offset + 500).map(m => m.companyId)),
        eq(records.type, FILING_NAMES_STATUS)));
      for (const gap of gaps) {
        if (!["no_filing_in_archive", "no_filing_in_archive_newer_sec_unavailable"].includes(String(gap.data.reason))) continue;
        await db.transaction(async tx => {
          if (gap.data.public_check_source_id === fetched.source.id) return;
          const citation = await companyFileEvidence(tx, fetched.source, gap.companyId, {
            method: "official_bulk_manifest_availability", status: fetched.source.status, error: fetched.source.error,
            httpStatus: fetched.source.httpStatus,
          });
          await tx.update(records).set({ data: { ...gap.data, reason: "no_filing_in_archive_newer_sec_unavailable",
            public_check_source_id: fetched.source.id, newer_sec_status: fetched.source.status,
            newer_sec_http_status: fetched.source.httpStatus, newer_sec_reason: fetched.source.error,
            newer_sec_url: MANIFEST, newer_sec_checked_at: new Date().toISOString() },
          sourceIds: [...new Set([...gap.sourceIds, citation.id])] }).where(eq(records.id, gap.id));
          marked++;
        });
      }
    }
    return { available: false, sourceId: fetched.source.id, status: fetched.source.status,
      httpStatus: fetched.source.httpStatus, reason: fetched.source.error, marked };
  }
  if (!input.companyIds?.length) throw new DomainError("invalid_input", "provide companyIds or markArchiveGaps");
  const selected = members.filter(m => input.companyIds!.includes(m.companyId));
  if (selected.length !== new Set(input.companyIds).size) throw new DomainError("invalid_input", "spot checks require Accept or Hold sector members");
  const items = [];
  for (const member of selected) {
    const companyId = member.companyId;
    const crd = member.crd;
    const runId = await getOrCreateManualRun(db, companyId);
    const policy = { runId, companyId, collector: COLLECTOR, userAgent: SEC_FIRM_USER_AGENT, strictRobots: true };
    const page = crd ? await fetchUrl(db, { ...policy, url: `https://adviserinfo.sec.gov/firm/summary/${encodeURIComponent(crd)}`,
      redirectHost: "adviserinfo.sec.gov" }) : null;
    const report = crd && page?.source.status === "ok" ? await fetchUrl(db, { ...policy,
      url: `https://reports.adviserinfo.sec.gov/reports/ADV/${encodeURIComponent(crd)}/PDF/${encodeURIComponent(crd)}.pdf`,
      redirectHost: "reports.adviserinfo.sec.gov", accept: "application/pdf" }) : null;
    let outcome = !crd ? "missing_stored_crd" : report?.source.status !== "ok" || !report.body ? "unavailable" : "unparseable_schedule_a";
    let filedCount: number | null = null;
    let matched: number | null = null;
    let archiveCount: number | null = null;
    if (report?.source.status === "ok" && report.body) {
      try {
        const parsed = parseScheduleA((await pdfTextAndItems(report.body)).items);
        const rows = await db.select({ type: records.type, data: records.data, sourceIds: records.sourceIds }).from(records)
          .where(and(eq(records.companyId, companyId), inArray(records.type, [FILING_PEOPLE, FILING_NAMES_STATUS])));
        const stored = new Set(filingPeople(rows).map(p => key(p.name)));
        // PDF parsing is used only as a spot check, never as a source of guessed ownership or entity types.
        const names = new Set(parsed.filter(p => isContactName(formatFiledName(p.name))).map(p => key(p.name)));
        archiveCount = stored.size; filedCount = names.size;
        matched = [...stored].filter(n => names.has(n)).length;
        if (names.size) outcome = matched === stored.size && stored.size === names.size ? "match" : "mismatch";
      } catch { outcome = "unparseable_schedule_a"; }
    }
    const source = report?.source ?? page?.source;
    const item = { companyId, tier: member.tier, outcome, archiveCount, filedCount, matched,
      publicPageStatus: page?.source.status ?? null, reportStatus: report?.source.status ?? null,
      reason: source?.error ?? null, httpStatus: source?.httpStatus ?? null, sourceId: source?.id ?? null };
    if (source) {
      const result = await upsertRecords(db, { companyId, runId, createdBy: COLLECTOR, records: [{
        type: COLLECTOR, naturalKey: ["source_id"], sourceIds: [source.id],
        data: { ...item, source_id: source.id, checked_at: new Date().toISOString(), page_source_id: page?.source.id ?? null },
      }] });
      const failed = result.find(r => !r.ok);
      if (failed && !failed.ok) throw new Error(failed.error);
    }
    items.push(item);
  }
  return { items };
}
