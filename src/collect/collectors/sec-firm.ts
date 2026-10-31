import { inflateSync } from "node:zlib";
import { addFacts } from "../../domain/research/facts.js";
import { upsertRecords } from "../../domain/research/records.js";
import type { Collector, CollectorCtx } from "./types.js";
import { collectFetch, fetchFailure, writeExtract } from "./util.js";

/**
 * SEC firm collector (Stage 5.7 B4): for one adviser, the IAPD firm record
 * plus the Form ADV Part 1 compilation (Schedule A officers, custodians,
 * disclosures). The Part 2A brochure Items 4/5/9/12/15 are read by deep
 * research from the same filing; this collector stores the filing text it
 * can extract deterministically. Only through fetchUrl, SEC User-Agent,
 * polite host delay. Playbook exception (D-69): may name filings/fee terms.
 */

export const SEC_FIRM_USER_AGENT = "Kardata karthik@kardata.co";
const COLLECTOR = "sec_firm";
const TITLE_HINT =
  /\b(chief|president|officer|partner|director|founder|principal|manager|compliance|operations|ceo|coo|cco)\b/i;

/** Minimal PDF text recovery: literal strings in plain or Flate streams. */
export function extractPdfText(body: Buffer): string {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const s = body.indexOf("stream", from);
    if (s < 0) break;
    const e = body.indexOf("endstream", s);
    if (e < 0) break;
    let data = body.subarray(s + 6, e);
    if (data[0] === 0x0d && data[1] === 0x0a) data = data.subarray(2);
    else if (data[0] === 0x0a || data[0] === 0x0d) data = data.subarray(1);
    let text: string;
    try {
      text = inflateSync(data).toString("latin1");
    } catch {
      text = data.toString("latin1");
    }
    for (const m of text.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      const raw = m[0].slice(1, -1).replace(/\\([()\\])/g, "$1").replace(/\\n/g, " ");
      if (raw.trim() !== "") parts.push(raw);
    }
    from = e + 9;
    if (parts.length > 4000) break;
  }
  // Postgres text cannot hold NUL bytes; raw PDF strings can contain them.
  return parts.join("\n").replace(/\u0000/g, "").slice(0, 60_000);
}

export function parseLeaders(text: string): { name: string; title: string }[] {
  const out: { name: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3})\s*[|,\-–]\s*(.{3,80})$/.exec(line.trim());
    if (!m || !m[1] || !m[2]) continue;
    if (!TITLE_HINT.test(m[2])) continue;
    const key = m[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: m[1].trim(), title: m[2].trim() });
    if (out.length >= 30) break;
  }
  return out;
}

export function custodianSnippet(text: string): string | null {
  const idx = text.toLowerCase().indexOf("custodian");
  if (idx < 0) return null;
  const snippet = text.slice(Math.max(0, idx - 120), idx + 380).replace(/\s+/g, " ").trim();
  return snippet === "" ? null : snippet;
}

interface FirmHit {
  firm_source_id?: string;
  firm_ia_disclosure_fl?: string;
  firm_disclosure_fl?: string;
  firm_ia_scope?: string;
  firm_name?: string;
  ia_firm_name?: string;
}

export const secFirmCollector: Collector = {
  name: COLLECTOR,
  areas: ["financials", "decisions"],
  run: async (ctx: CollectorCtx) => {
    const crd = ctx.company.secCrd?.trim() ?? "";
    if (crd === "") {
      const reason = "no SEC CRD on the company";
      return {
        outcomes: [
          { area: "financials", status: "skipped" as const, reason },
          { area: "decisions", status: "skipped" as const, reason },
        ],
      };
    }
    const apiUrl = `${ctx.endpoints.adviserApi}/search/firm?query=${encodeURIComponent(crd)}&hl=false`;
    const api = await collectFetch(ctx, COLLECTOR, apiUrl, {
      accept: "application/json",
      userAgent: SEC_FIRM_USER_AGENT,
    });
    if (api.source.status !== "ok" || !api.text) {
      const status =
        api.source.status === "blocked" || api.source.status === "robots_disallowed"
          ? ("blocked" as const)
          : api.source.status === "error"
            ? ("error" as const)
            : ("not_found" as const);
      const reason = `adviser firm lookup: ${fetchFailure(api)}`;
      return {
        outcomes: [
          { area: "financials", status, reason },
          { area: "decisions", status, reason },
        ],
      };
    }
    let hit: FirmHit | null = null;
    try {
      const parsed = JSON.parse(api.text) as { hits?: { hits?: { _source?: FirmHit }[] } };
      const hits = parsed?.hits?.hits ?? [];
      hit = hits.map((h) => h._source ?? {}).find((s) => String(s.firm_source_id ?? "") === crd) ?? hits[0]?._source ?? null;
    } catch {
      const reason = "adviser firm lookup returned invalid JSON";
      return {
        outcomes: [
          { area: "financials", status: "error" as const, reason },
          { area: "decisions", status: "error" as const, reason },
        ],
      };
    }
    if (!hit || String(hit.firm_source_id ?? "") !== crd) {
      const reason = `no adviser firm for CRD ${crd}`;
      return {
        outcomes: [
          { area: "financials", status: "not_found" as const, reason },
          { area: "decisions", status: "not_found" as const, reason },
        ],
      };
    }
    const sourceIds = [api.source.id];
    const pdfUrl = `${ctx.endpoints.adviserReports}/reports/ADV/${encodeURIComponent(crd)}/PDF/${encodeURIComponent(crd)}.pdf`;
    const pdf = await collectFetch(ctx, COLLECTOR, pdfUrl, {
      accept: "application/pdf",
      userAgent: SEC_FIRM_USER_AGENT,
    });
    let filingText = "";
    if (pdf.source.status === "ok" && pdf.body) {
      sourceIds.push(pdf.source.id);
      filingText = extractPdfText(pdf.body);
    }
    const leaders = parseLeaders(filingText);
    const custodians = custodianSnippet(filingText);
    const disclosure = hit.firm_ia_disclosure_fl ?? hit.firm_disclosure_fl ?? null;
    const lines = [
      `Firm: ${hit.ia_firm_name ?? hit.firm_name ?? ctx.effective.name ?? crd} (CRD ${crd})`,
      `Adviser scope: ${hit.firm_ia_scope ?? "unknown"}`,
      `Disclosure flag: ${disclosure ?? "unknown"}`,
      custodians ? `Custodians (filing excerpt): ${custodians}` : "Custodians: not in the extracted filing text",
      leaders.length > 0
        ? `Officers:\n${leaders.map((l) => `- ${l.name} — ${l.title}`).join("\n")}`
        : "Officers: not in the extracted filing text",
      filingText !== "" ? `\nFiling text excerpt:\n${filingText.slice(0, 8000)}` : "\nFiling text: compilation PDF not extracted",
    ];
    await writeExtract(ctx, COLLECTOR, "financials/sec-firm.md", "SEC firm filing", lines.join("\n"), sourceIds);
    // Facts/records through the research domain (non-strict: filing keys are
    // created by the SEC import; disclosure/custodian keys start here).
    const factResults = await addFacts(ctx.db, {
      companyId: ctx.companyId,
      runId: ctx.runId,
      createdBy: `collector:${COLLECTOR}`,
      facts: [
        ...(disclosure !== null
          ? [{ key: "firm.disclosure_flag", value: disclosure, sourceIds, confidence: "high" as const }]
          : []),
        ...(custodians !== null
          ? [{ key: "firm.custodians", value: custodians, sourceIds, confidence: "medium" as const }]
          : []),
      ],
    });
    const factFail = factResults.find((r) => !r.ok);
    if (factFail && !factFail.ok) throw new Error(`fact write failed (${COLLECTOR}): ${factFail.error}`);
    if (leaders.length > 0) {
      const recResults = await upsertRecords(ctx.db, {
        companyId: ctx.companyId,
        runId: ctx.runId,
        createdBy: `collector:${COLLECTOR}`,
        records: leaders.map((l) => ({
          type: "leader",
          data: { name: l.name, title: l.title },
          sourceIds,
          quote: `${l.name} — ${l.title}`,
          quoteSourceId: sourceIds[0] ?? "",
        })),
      });
      const recFail = recResults.find((r) => !r.ok);
      if (recFail && !recFail.ok) throw new Error(`record write failed (${COLLECTOR}): ${recFail.error}`);
    }
    return {
      outcomes: [
        { area: "financials", status: "done" as const },
        { area: "decisions", status: "done" as const },
      ],
    };
  },
};
