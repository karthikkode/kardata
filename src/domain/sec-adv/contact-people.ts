import { isContactName } from "../../lib/contact-name.js";

export const FILING_PEOPLE = "sec_schedule_a_person";
export const FILING_NAMES_STATUS = "sec_schedule_a_names_status";
export const FILING_LABEL = "Public filing name; unconfirmed and may be out of date";
export const OWNERSHIP_RANGES: Record<string, string> = {
  NA: "under 5%", A: "5% to under 10%", B: "10% to under 25%", C: "25% to under 50%",
  D: "50% to under 75%", E: "75% or more", F: "other ownership status",
};

/** Form ADV explicitly uses LAST, FIRST, MIDDLE. Preserve spelling/case. */
export function formatFiledName(raw: string): string {
  const parts = raw.split(",").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  return (parts.length > 1 ? [...parts.slice(1), parts[0]!] : parts).join(" ");
}

export interface ContactPerson {
  name: string;
  title: string;
  entityType?: string;
  ownershipCode?: string | null;
  ownershipRange?: string | null;
  controlPerson?: boolean | null;
  source?: string;
  sourceIds?: string[];
  filingId?: string;
  filingDate?: string;
  verification?: string;
  uncertainty?: string;
}
export interface ContactRecord {
  type: string;
  data: Record<string, unknown>;
  verification?: string;
  sourceIds?: string[];
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const confirmed = (p: ContactPerson) => ["verified", "doc_only", "verified_value", "confirmed", "apollo"].includes(p.verification ?? "");
const nameKey = (name: string) => formatFiledName(name).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function filingPeople(rows: ContactRecord[]): ContactPerson[] {
  const statuses = rows.filter(r => r.type === FILING_NAMES_STATUS).sort((a, b) =>
    text(b.data.filing_date).localeCompare(text(a.data.filing_date)) ||
    text(b.data.filing_id).localeCompare(text(a.data.filing_id), "en", { numeric: true }));
  const latest = statuses[0];
  const people = rows.filter(r => r.type === FILING_PEOPLE && (!latest || r.data.filing_id === latest.data.filing_id));
  return people.map(r => ({
    name: text(r.data.name), title: text(r.data.title), entityType: "individual",
    ownershipCode: text(r.data.ownership_code) || null, ownershipRange: text(r.data.ownership_range) || null,
    controlPerson: typeof r.data.control_person === "boolean" ? r.data.control_person : null,
    source: "SEC Form ADV Schedule A", sourceIds: r.sourceIds ?? [],
    filingId: text(r.data.filing_id), filingDate: text(r.data.filing_date),
    verification: "unconfirmed_public_filing", uncertainty: FILING_LABEL,
  }));
}

/** Confirmed records retain their name/title; a filing never replaces them. */
export function contactCandidates(rows: ContactRecord[], others: ContactPerson[] = []): ContactPerson[] {
  const leaders = rows.filter(r => r.type === "leader").map(r => ({
    name: text(r.data.name), title: text(r.data.title ?? r.data.role), source: "leader records",
    verification: r.verification, sourceIds: r.sourceIds,
  }));
  const byPerson = new Map<string, ContactPerson>();
  for (const person of filingPeople(rows)) {
    const key = nameKey(person.name);
    const existing = byPerson.get(key);
    if (!existing) { byPerson.set(key, { ...person }); continue; }
    // Several Schedule A statuses can name the same person. Keep every
    // reported role available to tier selection; raw rows remain in filingPeople.
    existing.title = [...new Set([existing.title, person.title].flatMap(t => t.split("; ")).filter(Boolean))].sort().join("; ");
    existing.sourceIds = [...new Set([...(existing.sourceIds ?? []), ...(person.sourceIds ?? [])])];
  }
  const filed = [...byPerson.values()];
  const all: ContactPerson[] = [...others, ...leaders, ...filed].map(p => ({ ...p })).sort((a, b) => Number(confirmed(b)) - Number(confirmed(a)) ||
    Number(b.verification === "unconfirmed_public_filing") - Number(a.verification === "unconfirmed_public_filing"));
  const seen = new Set<string>();
  return all.filter(p => {
    if (p.entityType && p.entityType !== "individual") return false;
    if (p.entityType !== "individual" && !isContactName(p.name)) return false;
    if (!p.name.trim()) return false;
    const key = nameKey(p.name);
    if (seen.has(key)) return false;
    // Ownership informs the solo-owner choice, while confirmed name/title/source stay intact.
    const ownership = filed.find(f => nameKey(f.name) === key);
    if (confirmed(p) && ownership) {
      p.ownershipCode ??= ownership.ownershipCode;
      p.ownershipRange ??= ownership.ownershipRange;
      p.controlPerson ??= ownership.controlPerson;
    }
    seen.add(key); return true;
  });
}

/** Same selection is used by the contacts tool and the sheet. */
export function bestContact<T extends ContactPerson>(people: T[], tier: string | number): T | null {
  const candidates = people.filter(p => (p.entityType === "individual" || isContactName(p.name)) &&
    (!p.entityType || p.entityType === "individual"));
  const ops = /\b(coo|chief operating|(?:head|director) of operations|operations (?:head|director))\b/i;
  const founder = /\b(founder|managing partner)\b/i;
  const cco = /\b(cco|chief compliance|compliance officer)\b/i;
  const office = /\b(operations|office) manager\b/i;
  if (String(tier) === "0") {
    const owners = candidates.filter(p => /\b(owner|founder|managing partner|sole proprietor)\b/i.test(p.title) ||
      (!!p.ownershipCode && ["A", "B", "C", "D", "E"].includes(p.ownershipCode)));
    const rank = (p: T) => "ABCDE".indexOf(p.ownershipCode ?? "") + Number(p.controlPerson === true) / 10;
    owners.sort((a, b) => rank(b) - rank(a));
    if (owners[0]) return owners[0];
  }
  const patterns = String(tier) === "2" ? [ops, cco, founder] : [founder, office, ops];
  for (const pattern of patterns) {
    const person = candidates.find(p => pattern.test(p.title));
    if (person) return person;
  }
  // A listed executive is still useful when the preferred title is absent.
  return candidates.find(p => /\b(president|ceo|owner|principal)\b/i.test(p.title)) ?? candidates[0] ?? null;
}
