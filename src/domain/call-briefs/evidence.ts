import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { load } from "cheerio";
import type { Db } from "../../db/client.js";
import { blobs, companies, documents, facts, records, sources } from "../../db/schema.js";
import { fetchUrl, type FetchResult } from "../../collect/fetch.js";
import { SEC_FIRM_USER_AGENT } from "../../collect/collectors/sec-firm.js";
import { decodeSecCsv, extractSecCsv, parseSecCsv, parseSecDate, type SecCompany } from "../../lib/sec/parse.js";
import { pdfReviewPages } from "../../lib/sec/pdf-text.js";
import { bestContact, contactCandidates, FILING_NAMES_STATUS, FILING_PEOPLE } from "../sec-adv/contact-people.js";
import { brochureKind } from "../ria-steps/brochure.js";
import { SNAPSHOT_FIELDS } from "../sec-adv/fields.js";
import { normalizeCrd } from "../sec-adv/snapshot.js";
import { extractText } from "../research/reads.js";
import { saveDocument } from "../research/documents.js";
import { parseBrochureChoice } from "../ria-steps/handlers.js";
import type { CitedFact, Evidence } from "./brief.js";
import { DomainError } from "../errors.js";

export interface FetchNote { url: string; status: string; reason: string | null; sourceId: string | null }
export type DeniedHosts = Map<string, string>;
const KEYS = ["firm.regulatory_aum", "firm.accounts", "firm.client_total", "firm.client_total_low", "firm.client_total_high",
  "firm.client_individuals", "firm.client_hnw", "firm.compensation_types", "financials.employees"];
const TRUSTED = ["verified", "verified_value", "doc_only"] as const;
type FactRow = typeof facts.$inferSelect;
export const factValue = (f: FactRow) => f.valueNum !== null ? Number(f.valueNum) : f.valueText ?? f.valueDate ?? f.valueBool ?? f.valueJson;
const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2).replace(/\.00$/, "")}m` : `$${n.toLocaleString("en-US")}`;
const scalar = (value: unknown) => typeof value === "number" ? value.toLocaleString("en-US") : Array.isArray(value) ? value.join(", ") : String(value);
const monthlyRows = new Map<string, Promise<Map<string, SecCompany>>>();

/** Verify the retained canonical file before using a raw column not represented by a fact. */
export async function verifiedMonthlyRow(db: Db, source: typeof sources.$inferSelect, crd: string | null) {
  const fileId = source.details?.fileSourceId;
  if (source.collector !== "sec_adv_snapshot" || typeof fileId !== "string" || !crd) return null;
  const [file] = await db.select().from(sources).where(eq(sources.id, fileId));
  const digest = file?.details?.digest;
  if (!file || file.url !== source.url || file.collector !== "sec_adv_snapshot" || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) return null;
  const url = new URL(file.url), name = basename(url.pathname);
  if (url.protocol !== "https:" || !(url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov")) || !/\.(?:zip|csv)$/i.test(name)) return null;
  const key = `${fileId}:${digest}`;
  let pending = monthlyRows.get(key);
  if (!pending) {
    pending = (async () => {
      const body = await readFile(resolve("var/sources/sec", name));
      if (createHash("sha256").update(body).digest("hex") !== digest) throw new Error("stored SEC file digest differs from source");
      const parsed = parseSecCsv(/\.zip$/i.test(name) ? extractSecCsv(body).text : decodeSecCsv(body));
      const rows = new Map(parsed.rows.flatMap(row => normalizeCrd(row.crd) ? [[normalizeCrd(row.crd)!, row] as const] : []));
      if (parsed.skipped.length || rows.size !== parsed.rows.length) throw new Error("invalid or duplicate CRDs in stored SEC file");
      return rows;
    })();
    if (monthlyRows.size >= 8) monthlyRows.delete(monthlyRows.keys().next().value!);
    monthlyRows.set(key, pending);
    pending.catch(() => monthlyRows.delete(key));
  }
  return (await pending).get(normalizeCrd(crd)!) ?? null;
}

export async function monthlySourceRow(db: Db, input: { companyId: string; sourceId: string }) {
  const [company] = await db.select({ crd: companies.secCrd }).from(companies).where(eq(companies.id, input.companyId));
  const [source] = await db.select().from(sources).where(and(eq(sources.id, input.sourceId), eq(sources.companyId, input.companyId), eq(sources.status, "ok")));
  if (!company || !source) throw new DomainError("not_found", "company-owned SEC source not found");
  const row = await verifiedMonthlyRow(db, source, company.crd);
  if (!row) throw new DomainError("not_found", "verified stored SEC monthly row not available");
  return { companyId: input.companyId, sourceId: source.id, url: source.url, crd: row.crd,
    rowNumber: row.rowNumber, filingDate: row.filingDate, raw: row.raw };
}
export function changePercent(before: number, after: number): string | null {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
  const n = (after - before) / before * 100;
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}
export function currentSnapshot(rows: FactRow[]) {
  const snapshot = rows.map(f => f.qualifiers.snapshot ?? "").sort().at(-1);
  return rows.filter(f => snapshot ? f.qualifiers.snapshot === snapshot : !f.qualifiers.snapshot);
}
export function registrationAge(date: string, callDate: string) {
  const start = new Date(date), end = new Date(callDate);
  if (!Number.isFinite(start.getTime()) || start > end) return "duration not found";
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate()) months--;
  return `${Math.floor(months / 12)}y ${months % 12}m at call date`;
}

export async function storedBriefEvidence(db: Db, companyId: string, callDate: string) {
  const company = (await db.select().from(companies).where(eq(companies.id, companyId)))[0]!;
  const rows = await db.select().from(facts).where(and(eq(facts.companyId, companyId), inArray(facts.key, KEYS), inArray(facts.verification, [...TRUSTED])))
    .orderBy(desc(facts.asOf), desc(facts.createdAt), facts.id);
  const peopleRows = await db.select({ id: records.id, type: records.type, data: records.data, sourceIds: records.sourceIds,
    verification: records.verification }).from(records).where(and(eq(records.companyId, companyId), inArray(records.type, [FILING_PEOPLE, FILING_NAMES_STATUS])))
    .orderBy(records.createdAt, records.id);
  const owner = bestContact(contactCandidates(peopleRows), 0);
  const sourceIds = [...new Set([...rows.flatMap(f => f.sourceIds), ...peopleRows.flatMap(r => r.sourceIds)])];
  const sourceRows = sourceIds.length ? await db.select().from(sources).where(and(eq(sources.companyId, companyId), eq(sources.status, "ok"), inArray(sources.id, sourceIds))) : [];
  const sourceMap = new Map(sourceRows.map(s => [s.id, s]));
  const evidence: Evidence[] = [], baseFacts: CitedFact[] = [], gaps: string[] = [];
  const add = (id: string, label: string, text: string, e: Evidence) => {
    evidence.push(e); baseFacts.push({ id, label, text, evidenceId: e.id, quote: e.text });
  };
  if (owner?.filingId && owner.filingDate && owner.sourceIds?.[0] && sourceMap.has(owner.sourceIds[0])) {
    const source = sourceMap.get(owner.sourceIds[0])!;
    const record = peopleRows.find(r => r.type === FILING_PEOPLE && r.data.filing_id === owner.filingId && String(r.data.name).toLowerCase() === owner.name.toLowerCase());
    add("owner", "owner", `${owner.name} — ${owner.title || "title not found"} (as filed ${owner.filingDate}, unconfirmed)`, {
      id: "owner", sourceId: source.id, url: source.url, date: owner.filingDate, dateKind: "as filed", kind: "schedule_a",
      text: `${owner.name}; ${owner.title}; filing ${owner.filingId}; ${owner.filingDate}`, recordId: record?.id,
      locator: `filing ${owner.filingId}, Schedule A, Full Legal Name: ${String(record?.data.raw_name ?? owner.name)}`,
    });
  } else gaps.push("Schedule A owner name not found in stored contacts");
  const canonicalSource = currentSnapshot(rows).flatMap(f => f.sourceIds).map(id => sourceMap.get(id)).find(s => s?.collector === "sec_adv_snapshot" && s.details?.fileSourceId);
  let canonical: SecCompany | null = null;
  if (canonicalSource) {
    try { canonical = await verifiedMonthlyRow(db, canonicalSource, company.secCrd); }
    catch { gaps.push("registration column could not be checked against the stored SEC file"); }
  }
  const rawSource = rows.find(f => f.createdBy === "collector:sec_import" && f.sourceIds.some(id => sourceMap.has(id)));
  const raw = canonical?.raw ?? (rawSource ? company.raw : {});
  const registered = parseSecDate(String(raw["SEC Status Effective Date"] ?? ""));
  const registrationSource = canonical && canonicalSource ? canonicalSource : rawSource ? sourceMap.get(rawSource.sourceIds.find(id => sourceMap.has(id))!) : null;
  if (registered && registered <= callDate && registrationSource) {
    const source = registrationSource;
    add("registration", "registration", `SEC status since ${registered} (${registrationAge(registered, callDate)})`, {
      id: "registration", sourceId: source.id, url: source.url,
      date: parseSecDate(String(raw["Latest ADV Filing Date"] ?? "")) ?? rawSource?.asOf ?? source.fetchedAt.toISOString().slice(0, 10),
      dateKind: "as filed", kind: "sec", text: `SEC Status Effective Date: ${raw["SEC Status Effective Date"]}`,
      locator: `SEC Status Effective Date: ${raw["SEC Status Effective Date"]}${canonical ? `, CSV row ${canonical.rowNumber}` : ""}; earlier state registration not found`,
    });
  } else gaps.push("SEC registration effective date not found");
  const usable = rows.filter(f => f.asOf && f.sourceIds.some(id => sourceMap.has(id)));
  const current = currentSnapshot(usable);
  const selected = new Map<string, FactRow>();
  for (const f of current) if (!selected.has(f.key)) selected.set(f.key, f);
  const labels: Record<string, string> = { "firm.regulatory_aum": "AUM", "firm.accounts": "accounts", "financials.employees": "staff",
    "firm.client_total": "clients", "firm.client_total_low": "client lower bound", "firm.client_total_high": "client upper bound" };
  const evidenceFor = (f: FactRow): Evidence => {
    const s = sourceMap.get(f.sourceIds.find(id => sourceMap.has(id))!)!;
    return { id: `f-${f.id}`, factId: f.id, sourceId: s.id, url: s.url, date: f.asOf!, dateKind: "as filed", kind: "sec",
      text: `${f.key}: ${JSON.stringify(factValue(f))}; snapshot ${f.qualifiers.snapshot ?? "import"}`,
      locator: `${SNAPSHOT_FIELDS.find(x => x.key === f.key)?.column ?? f.key}=${JSON.stringify(factValue(f))}${s.details?.row ? `, CSV row ${s.details.row}` : ""}` };
  };
  for (const key of ["firm.regulatory_aum", "firm.accounts", "financials.employees"]) {
    const f = selected.get(key);
    if (!f) { gaps.push(`${labels[key]} not found`); continue; }
    const value = factValue(f);
    add(`size-${key}`, "size", `${labels[key]} ${key === "firm.regulatory_aum" && typeof value === "number" ? money(value) : scalar(value)}`, evidenceFor(f));
  }
  const low = selected.get("firm.client_total_low"), high = selected.get("firm.client_total_high"), clients = selected.get("firm.client_total");
  if (low && high && factValue(low) !== factValue(high)) {
    evidence.push(evidenceFor(low), evidenceFor(high));
    baseFacts.push({ id: "clients", label: "size", text: `clients ${scalar(factValue(low))}–${scalar(factValue(high))} (SEC-suppressed counts)`,
      evidenceId: `f-${low.id}`, evidenceIds: [`f-${low.id}`, `f-${high.id}`], quote: `${factValue(low)}–${factValue(high)}` });
  } else if (clients ?? low) { const f = (clients ?? low)!; add("clients", "size", `clients ${scalar(factValue(f))}`, evidenceFor(f)); }
  else gaps.push("client count not found");
  const compensation = selected.get("firm.compensation_types");
  if (compensation) {
    const terms = scalar(factValue(compensation)).replace(/percentage_of_aum/g, "% of assets").replace(/_/g, " ");
    add("sec-fees", "fees", `SEC fee boxes: ${terms}`, evidenceFor(compensation));
  }
  const individual = selected.get("firm.client_individuals"), hnw = selected.get("firm.client_hnw");
  if (individual && hnw) {
    evidence.push(evidenceFor(individual), evidenceFor(hnw));
    baseFacts.push({ id: "sec-clients", label: "clients", text: `SEC: ${scalar(factValue(individual))} individuals, ${scalar(factValue(hnw))} high-net-worth`,
      evidenceId: `f-${individual.id}`, evidenceIds: [`f-${individual.id}`, `f-${hnw.id}`], quote: `${factValue(individual)} individuals; ${factValue(hnw)} HNW` });
  }
  const currentMonth = current[0]?.qualifiers.snapshot;
  const previous = [...new Set(usable.map(f => f.qualifiers.snapshot).filter((s): s is string => !!s && !!currentMonth && s < currentMonth))].sort();
  for (const month of [...new Set([previous.at(-1), previous.length > 1 ? previous[0] : undefined])].filter((s): s is string => !!s)) {
    for (const key of ["firm.regulatory_aum", "firm.accounts"]) {
      const before = usable.find(f => f.key === key && f.qualifiers.snapshot === month), after = selected.get(key);
      if (!before || !after) continue;
      const first = factValue(before), last = factValue(after);
      if (typeof first !== "number" || typeof last !== "number") continue;
      const e = evidenceFor(before), latest = evidenceFor(after); evidence.push(e);
      const percent = changePercent(first, last);
      baseFacts.push({ id: `change-${key}-${month}`, label: "change",
        text: `${labels[key]} ${percent ?? "change not comparable from zero"} vs ${month} snapshot (${key === "firm.regulatory_aum" ? money(first) : scalar(first)})`,
        evidenceId: latest.id, evidenceIds: [latest.id, e.id], quote: `${first} to ${last}` });
    }
  }
  if (!previous.length) gaps.push("earlier comparable SEC snapshot not found");
  return { company, owner: owner?.name ?? null, evidence, baseFacts, gaps };
}

const socialOrLogin = (url: URL) => /(^|\.)(linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com)$/i.test(url.hostname) ||
  /(?:^|\/)(?:login|sign[-_]?in|auth|portal)(?:\/|$)/i.test(url.pathname);
export function publicLinks(html: string, base: string) {
  const $ = load(html), result: { url: string; score: number; pdf: boolean }[] = [];
  $("a[href]").each((_, node) => {
    const a = $(node); let url: URL;
    try { url = new URL(a.attr("href")!, base); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || socialOrLogin(url)) return;
    const label = `${a.text()} ${url.pathname}`;
    const pdf = /\.pdf(?:$|\?)/i.test(url.href) || (url.hostname === "files.adviserinfo.sec.gov" && /crd_iapd_Brochure\.aspx/i.test(url.pathname));
    const score = /\badv\b|brochure|part[ -]?2a/i.test(label) ? 100 :
      /disclosure|regulatory/i.test(label) ? 90 : /services|what.we.do|financial.planning|wealth.management/i.test(label) ? 70 :
      /fee|pricing|about|team|our.firm|client.resources|resources/i.test(label) ? 60 : 0;
    if (!score || (pdf && score < 90)) return;
    if (!pdf && url.hostname.replace(/^www\./, "") !== new URL(base).hostname.replace(/^www\./, "")) return;
    url.hash = ""; result.push({ url: url.href, score, pdf });
  });
  return [...new Map(result.sort((a, b) => b.score - a.score).map(r => [r.url, r])).values()];
}

export function firmBrochureCover(cover: string) {
  const kind = brochureKind(cover);
  return kind === "firm" || (kind === "unknown" && /form\s+adv[\s\S]{0,80}part\s+2a/i.test(cover));
}

export async function publicBriefEvidence(db: Db, input: { companyId: string; runId: string; website: string | null;
  crd: string | null; denied: DeniedHosts }, fetchPage = fetchUrl) {
  const evidence: Evidence[] = [], notes: FetchNote[] = [], gaps: string[] = [];
  let brochureFound = false, websiteRead = false;
  const addPdf = async (source: typeof sources.$inferSelect, body: Buffer, date: string, dateKind: Evidence["dateKind"]) => {
    const pages = await pdfReviewPages(body);
    if (!firmBrochureCover(pages.slice(0, 2).join("\n"))) return false;
    brochureFound = true;
    let chars = 0;
    for (const [i, text] of pages.entries()) {
      if (!text.trim() || chars > 130000) continue;
      evidence.push({ id: `p-${source.id}-${i + 1}`, sourceId: source.id, url: source.url, date, dateKind, kind: "brochure", page: i + 1, text });
      chars += text.length;
    }
    await saveDocument(db, { companyId: input.companyId, runId: input.runId, path: `other/call-evidence/${source.id}.md`,
      title: `Public Part 2A brochure (${dateKind} ${date})`, sourceIds: [source.id], createdBy: "solo_call_brief",
      contentMd: pages.map((text, i) => `## Physical PDF page ${i + 1}\n${text}`).join("\n\n").slice(0, 450000) });
    return true;
  };
  const retained = await db.select({ source: sources, gzip: blobs.gzip }).from(sources).innerJoin(blobs, eq(sources.blobSha256, blobs.sha256))
    .where(and(eq(sources.companyId, input.companyId), eq(sources.status, "ok"))).orderBy(desc(sources.fetchedAt)).limit(20);
  const docs = await db.select({ sourceIds: documents.sourceIds, title: documents.title }).from(documents)
    .where(and(eq(documents.companyId, input.companyId), eq(documents.isCurrent, true)));
  for (const row of retained) {
    if (brochureFound) break;
    const body = gunzipSync(row.gzip);
    if (body.subarray(0, 5).toString("ascii") !== "%PDF-") continue;
    const date = docs.find(d => d.sourceIds.includes(row.source.id))?.title.match(/\b\d{4}-\d\d-\d\d\b/)?.[0];
    try { await addPdf(row.source, body, date ?? row.source.fetchedAt.toISOString().slice(0, 10), date ? "as filed" : "read"); }
    catch { gaps.push("stored brochure PDF unreadable"); }
  }
  const request = async (url: string, homepage?: string): Promise<FetchResult | null> => {
    const target = new URL(url), denied = input.denied.get(target.hostname);
    if (socialOrLogin(target) || denied) {
      notes.push({ url, status: "skipped", reason: denied ?? "social or login URL excluded", sourceId: null }); return null;
    }
    const result = await fetchPage(db, { runId: input.runId, companyId: input.companyId, collector: "solo_call_brief",
      url, userAgent: SEC_FIRM_USER_AGENT, strictRobots: true, timeoutMs: 20000, maxBytes: 20 * 1024 ** 2,
      ...(homepage ? { redirectSite: homepage } : { redirectHost: target.hostname }) });
    notes.push({ url, status: result.source.status, reason: result.source.error, sourceId: result.source.id });
    if (result.source.status === "blocked" || result.source.status === "robots_disallowed" || result.source.httpStatus === 403) {
      input.denied.set(target.hostname, `${result.source.status}: ${result.source.error ?? result.source.httpStatus}`);
    }
    return result;
  };
  let homepage: URL | null = null;
  if (input.website?.trim()) {
    try { homepage = new URL(/^https?:\/\//i.test(input.website) ? input.website : `https://${input.website}`); homepage.protocol = "https:"; }
    catch { gaps.push("invalid stored website URL"); }
  }
  if (homepage) {
    const home = await request(homepage.href, homepage.href);
    if (home?.source.status === "ok" && home.body && /html/i.test(home.contentType ?? "text/html")) {
      const queue = publicLinks(home.body.toString("utf8"), home.source.finalUrl);
      const seen = new Set([homepage.href]); let pages = 0, pdfs = 0;
      const addHtml = (result: FetchResult) => {
        const html = result.body!.toString("utf8"), text = extractText(html);
        if (text.trim().length < 80) return;
        websiteRead = true;
        const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)?.slice(0, 150).join("\n") ?? "";
        evidence.push({ id: `w-${result.source.id}`, sourceId: result.source.id, url: result.source.finalUrl,
          date: result.source.fetchedAt.toISOString().slice(0, 10), dateKind: "read", kind: "website", text: `${text.slice(0, 22000)}\n${anchors.slice(0, 22000)}` });
      };
      addHtml(home);
      while (queue.length && (pages < 4 || pdfs < 2)) {
        const next = queue.shift()!;
        if (seen.has(next.url)) continue; seen.add(next.url);
        if (next.pdf && (brochureFound || pdfs >= 2)) continue;
        if (!next.pdf && pages >= 4) continue;
        const result = await request(next.url, next.pdf ? undefined : homepage.href);
        if (next.pdf) pdfs++; else pages++;
        if (result?.source.status !== "ok" || !result.body) continue;
        if (result.body.subarray(0, 5).toString("ascii") === "%PDF-") {
          try { if (!await addPdf(result.source, result.body, result.source.fetchedAt.toISOString().slice(0, 10), "read")) gaps.push("public PDF is not a confirmed Part 2A brochure"); }
          catch { gaps.push("public brochure PDF unreadable"); }
        } else {
          addHtml(result);
          queue.push(...publicLinks(result.body.toString("utf8"), result.source.finalUrl).filter(l => l.score >= 90));
          queue.sort((a, b) => b.score - a.score);
        }
      }
    }
  } else gaps.push("official firm website not found in stored data");
  if (!brochureFound && input.crd) {
    // Use the official catalogue only. A blocked catalogue is a gap, never
    // an invitation to guess brochure versions or try alternate report hosts.
    const crd = encodeURIComponent(input.crd);
    const result = await request(`https://api.adviserinfo.sec.gov/search/firm/${crd}?hl=true&nrows=12&query=${crd}&r=25&sort=score%2Bdesc&wt=json`);
    if (result?.source.status === "ok" && result.body) {
      try {
        const parsed = JSON.parse(result.body.toString("utf8")) as { hits?: { hits?: { _source?: { firm_source_id?: string; iacontent?: string } }[] } };
        const hit = parsed.hits?.hits?.find(h => String(h._source?.firm_source_id) === input.crd)?._source;
        const choice = hit?.iacontent ? parseBrochureChoice(JSON.parse(hit.iacontent) as unknown).choice : null;
        if (choice) {
          const pdf = await request(`https://files.adviserinfo.sec.gov/IAPD/Content/Common/crd_iapd_Brochure.aspx?BRCHR_VRSN_ID=${choice.versionId}`);
          if (pdf?.source.status === "ok" && pdf.body) await addPdf(pdf.source, pdf.body, choice.dateSubmitted, "as filed");
        }
      } catch { gaps.push("official brochure catalogue/PDF unreadable"); }
    }
  }
  if (!brochureFound) gaps.push("Form ADV Part 2A brochure not found in permitted public/stored sources");
  if (!websiteRead) gaps.push("firm website not read: missing, excluded, empty or blocked (see fetch log)");
  return { evidence, notes, gaps, brochureFound, websiteRead };
}
