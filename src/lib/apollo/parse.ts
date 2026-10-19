import { parse } from "csv-parse/sync";

export const REQUIRED_HEADERS = ["Company Name", "Apollo Account Id"] as const;

/** The 47 headers of the real Apollo exports. Anything else lands in `raw` only. */
export const KNOWN_HEADERS = [
  "Company Name",
  "Company Name for Emails",
  "Account Stage",
  "Lists",
  "# Employees",
  "Industry",
  "Account Owner",
  "Website",
  "Company Linkedin Url",
  "Facebook Url",
  "Twitter Url",
  "Company Street",
  "Company City",
  "Company State",
  "Company Country",
  "Company Postal Code",
  "Company Address",
  "Keywords",
  "Company Phone",
  "Technologies",
  "Total Funding",
  "Latest Funding",
  "Latest Funding Amount",
  "Last Raised At",
  "Annual Revenue",
  "Number of Retail Locations",
  "Apollo Account Id",
  "Apollo Record Id",
  "SIC Codes",
  "NAICS Codes",
  "Short Description",
  "Founded Year",
  "Logo Url",
  "Parent company (Apollo data)",
  "Parent company (Apollo data - Organization ID)",
  "Ultimate Parent Company Name",
  "Ultimate Parent Company Website",
  "Number of Suborganizations",
  "Suborganization Domains",
  "Suborganization Names",
  "Primary Intent Topic",
  "Primary Intent Score",
  "Secondary Intent Topic",
  "Secondary Intent Score",
  "Prerequisite: Determine Research Guidelines",
  "Prerequisite: Research Target Company",
  "Qualify Account",
] as const;

export class ApolloFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApolloFileError";
  }
}

export interface SkippedRow {
  /** 1-based data record number (header excluded). */
  row: number;
  reason: string;
}

export interface ParsedCompany {
  rowNumber: number;
  apolloAccountId: string;
  name: string | null;
  website: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  employees: number | null;
  industry: string | null;
  keywords: string[];
  technologies: string[];
  country: string | null;
  state: string | null;
  city: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  annualRevenue: string | null;
  totalFunding: string | null;
  latestFunding: string | null;
  latestFundingAmount: string | null;
  lastRaisedAt: string | null;
  foundedYear: number | null;
  shortDescription: string | null;
  logoUrl: string | null;
  sicCodes: string[];
  naicsCodes: string[];
  /** Every original column, verbatim. */
  raw: Record<string, string>;
}

export interface ApolloParseResult {
  rows: ParsedCompany[];
  skipped: SkippedRow[];
}

function cleanString(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function parseIntField(value: string | undefined): number | null {
  const cleaned = (value ?? "").replace(/[$,]/g, "").trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

function parseNumericField(value: string | undefined): string | null {
  const cleaned = (value ?? "").replace(/[$,]/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

function parseListField(value: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (value ?? "").split(",")) {
    const item = part.trim();
    if (item === "") continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseDateField(value: string | undefined): string | null {
  const cleaned = (value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return cleaned;
}

/** Lowercase; strip protocol, leading `www.`, path, query and fragment. Empty → null. */
export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  let host = website.trim().toLowerCase();
  if (host === "") return null;
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  if (host.startsWith("//")) host = host.slice(2);
  const end = host.search(/[/?#]/);
  if (end >= 0) host = host.slice(0, end);
  if (host.startsWith("www.")) host = host.slice(4);
  host = host.trim();
  return host === "" ? null : host;
}

export function parseApolloCsv(text: string): ApolloParseResult {
  let table: string[][];
  try {
    table = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
  } catch (err) {
    throw new ApolloFileError(`unparseable CSV: ${(err as Error).message}`);
  }
  if (table.length === 0) throw new ApolloFileError("empty file: no header row");
  const headers = (table[0] ?? []).map((h) => h.trim());
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      throw new ApolloFileError(`missing required header: ${required}`);
    }
  }
  const rows: ParsedCompany[] = [];
  const skipped: SkippedRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    const raw: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c] ?? "";
      raw[header] = cells[c] ?? "";
    }
    const get = (h: string): string | undefined => raw[h];
    const rowNumber = i;
    const apolloAccountId = (get("Apollo Account Id") ?? "").trim();
    if (apolloAccountId === "") {
      skipped.push({ row: rowNumber, reason: "missing apollo id" });
      continue;
    }
    const website = cleanString(get("Website"));
    rows.push({
      rowNumber,
      apolloAccountId,
      name: cleanString(get("Company Name")),
      website,
      domain: normalizeDomain(website),
      linkedinUrl: cleanString(get("Company Linkedin Url")),
      facebookUrl: cleanString(get("Facebook Url")),
      twitterUrl: cleanString(get("Twitter Url")),
      employees: parseIntField(get("# Employees")),
      industry: cleanString(get("Industry")),
      keywords: parseListField(get("Keywords")),
      technologies: parseListField(get("Technologies")),
      country: cleanString(get("Company Country")),
      state: cleanString(get("Company State")),
      city: cleanString(get("Company City")),
      postalCode: cleanString(get("Company Postal Code")),
      address: cleanString(get("Company Address")),
      phone: cleanString(get("Company Phone")),
      annualRevenue: parseNumericField(get("Annual Revenue")),
      totalFunding: parseNumericField(get("Total Funding")),
      latestFunding: cleanString(get("Latest Funding")),
      latestFundingAmount: parseNumericField(get("Latest Funding Amount")),
      lastRaisedAt: parseDateField(get("Last Raised At")),
      foundedYear: parseIntField(get("Founded Year")),
      shortDescription: cleanString(get("Short Description")),
      logoUrl: cleanString(get("Logo Url")),
      sicCodes: parseListField(get("SIC Codes")),
      naicsCodes: parseListField(get("NAICS Codes")),
      raw,
    });
  }
  return { rows, skipped };
}
