import { inflateRawSync } from "node:zlib";
import { parse } from "csv-parse/sync";
import { normalizeDomain } from "../apollo/parse.js";

/**
 * SEC monthly investment adviser file (Stage 5.7 B2).
 * Verified 2026-10-31 on sec.gov: the "Information About Registered
 * Investment Advisers and Exempt Reporting Advisers" page links a ZIP
 * (for example .../information-about-registered-investment-advisers-exempt-reporting-advisers/ia100226.zip)
 * holding one CSV (iaMMDDYYYY.csv, ~448 Form ADV Part 1 columns).
 * Requests carry User-Agent "Kardata karthik@kardata.co" (sector README).
 */

export class SecFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecFileError";
  }
}

export interface SecCompany {
  rowNumber: number;
  crd: string;
  secNumber: string | null;
  firmType: string | null;
  name: string | null;
  legalName: string | null;
  website: string | null;
  domain: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  employees: number | null;
  regulatoryAum: number | null;
  accounts: number | null;
  wealthShare: number | null;
  individuals: number | null;
  hnw: number | null;
  totalClients: number | null;
  offices: number | null;
  privateFundCount: number | null;
  pensionClients: number | null;
  trustClients: number | null;
  compensationTypes: string[];
  registrationStatus: string | null;
  filingDate: string | null;
  raw: Record<string, string>;
}

export interface SecParseResult {
  rows: SecCompany[];
  skipped: { row: number; reason: string }[];
}

function clean(value: string | undefined): string | null {
  const t = (value ?? "").trim();
  return t === "" ? null : t;
}

export function parseMoneyField(value: string | undefined): number | null {
  const cleaned = (value ?? "").replace(/[$,]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseCountField(value: string | undefined): number | null {
  const cleaned = (value ?? "").replace(/[$,]/g, "").trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/** SEC filing dates are MM/DD/YYYY; stored as YYYY-MM-DD. */
export function parseSecDate(value: string | undefined): string | null {
  const t = (value ?? "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** File date from an iaMMDDYY.zip / iaMMDDYYYY.csv name, else null. */
export function secFileDate(name: string): string | null {
  const base = name.split("/").pop() ?? name;
  const m = /^ia(\d{2})(\d{2})(\d{4}|\d{2})/i.exec(base);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = (m[3] ?? "").length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const CLIENT_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"] as const;
const COMPENSATION: [string, string][] = [
  ["5E(1)", "percentage_of_aum"],
  ["5E(2)", "hourly"],
  ["5E(3)", "subscription"],
  ["5E(4)", "fixed"],
  ["5E(5)", "performance"],
  ["5E(6)", "commissions"],
  ["5E(7)", "other"],
];

export function parseSecCsv(text: string): SecParseResult {
  let table: string[][];
  try {
    table = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][];
  } catch (err) {
    throw new SecFileError(`unparseable CSV: ${(err as Error).message}`);
  }
  if (table.length === 0) throw new SecFileError("empty file: no header row");
  const headers = (table[0] ?? []).map((h) => h.trim());
  if (!headers.includes("Organization CRD#")) {
    throw new SecFileError("missing required header: Organization CRD#");
  }
  const rows: SecCompany[] = [];
  const skipped: { row: number; reason: string }[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    const raw: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) raw[headers[c] ?? ""] = cells[c] ?? "";
    const get = (h: string): string | undefined => raw[h];
    const rowNumber = i;
    const crd = (get("Organization CRD#") ?? "").trim();
    if (crd === "") {
      skipped.push({ row: rowNumber, reason: "missing crd" });
      continue;
    }
    const counts = new Map<string, number | null>();
    let totalClients = 0;
    let seenClients = false;
    for (const letter of CLIENT_LETTERS) {
      const n = parseCountField(get(`5D(${letter})(1)`));
      counts.set(letter, n);
      if (n !== null) {
        totalClients += n;
        seenClients = true;
      }
    }
    const individuals = counts.get("a") ?? null;
    const hnw = counts.get("b") ?? null;
    const pensionClients = counts.get("f") ?? null;
    const trustClients = counts.get("g") ?? null;
    const firstCount = (names: string[]): number | null => {
      for (const n of names) {
        const v = parseCountField(get(n));
        if (v !== null) return v;
      }
      return null;
    };
    const otherOffices = firstCount(["Number of Other Offices", "1F(1)", "1F", "Other Offices"]);
    const offices = otherOffices === null ? null : otherOffices + 1;
    const privateFundCount = firstCount(["Count of Private Funds - 7B(1)", "7B(1)", "Number of Private Funds", "7B"]);
    const wealthShare =
      seenClients && totalClients > 0 ? ((individuals ?? 0) + (hnw ?? 0)) / totalClients : null;
    const compensationTypes = COMPENSATION.filter(([h]) => (get(h) ?? "").trim().toUpperCase() === "Y").map(
      ([, label]) => label,
    );
    const street = [clean(get("Main Office Street Address 1")), clean(get("Main Office Street Address 2"))]
      .filter((x) => x !== null)
      .join(", ");
    // Private-residence main offices (Main Office Private Residence Flag Y)
    // have their address suppressed in the public file: city/state/country
    // are blank for ~1.4k firms. Fall back per field to the Mail Office,
    // then to the Location of Books and Records, so US firms are not
    // misread as foreign. The street stays the main office's only.
    const mainCity = clean(get("Main Office City"));
    const mainState = clean(get("Main Office State"));
    const mainCountry = clean(get("Main Office Country"));
    const suppressed = mainCity === null && mainState === null && mainCountry === null;
    const city = suppressed ? (clean(get("Mail Office City")) ?? clean(get("Location of Books and Records City"))) : mainCity;
    const state = suppressed ? (clean(get("Mail Office State")) ?? clean(get("Location of Books and Records State"))) : mainState;
    const country = suppressed ? (clean(get("Mail Office Country")) ?? clean(get("Location of Books and Records Country"))) : mainCountry;
    const website = clean(get("Website Address"));
    const accountsTotal = parseCountField(get("5F(2)(f)"));
    const accounts =
      accountsTotal ??
      (() => {
        const d = parseCountField(get("5F(2)(d)"));
        const e = parseCountField(get("5F(2)(e)"));
        return d === null && e === null ? null : (d ?? 0) + (e ?? 0);
      })();
    rows.push({
      rowNumber,
      crd,
      secNumber: clean(get("SEC#")),
      firmType: clean(get("Firm Type")),
      name: clean(get("Primary Business Name")) ?? clean(get("Legal Name")),
      legalName: clean(get("Legal Name")),
      website,
      domain: normalizeDomain(website),
      phone: clean(get("Main Office Telephone Number")),
      address: street === "" ? null : street,
      city,
      state,
      country,
      postalCode: clean(get("Main Office Postal Code")),
      employees: parseCountField(get("5A")),
      regulatoryAum: parseMoneyField(get("5F(2)(c)")),
      accounts,
      wealthShare,
      individuals,
      hnw,
      totalClients: seenClients ? totalClients : null,
      offices,
      privateFundCount,
      pensionClients,
      trustClients,
      compensationTypes,
      registrationStatus: clean(get("SEC Current Status")),
      filingDate: parseSecDate(get("Latest ADV Filing Date")),
      raw,
    });
  }
  return { rows, skipped };
}

/** Extract the single CSV from the SEC ZIP (stored or deflated entry). */
export function extractSecCsv(zip: Buffer): { csvName: string; text: string } {
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) {
    throw new SecFileError("not a ZIP file (want the SEC monthly ZIP or its CSV)");
  }
  // End of central directory: scan the tail for PK\x05\x06.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65536); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SecFileError("ZIP has no end-of-directory record");
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new SecFileError("corrupt ZIP directory");
    const method = zip.readUInt16LE(offset + 10);
    const compSize = zip.readUInt32LE(offset + 20);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith(".csv")) continue;
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new SecFileError("corrupt ZIP entry");
    const lName = zip.readUInt16LE(localOffset + 26);
    const lExtra = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lName + lExtra;
    const data = zip.subarray(start, start + compSize);
    if (method === 0) return { csvName: name, text: data.toString("utf8") };
    if (method === 8) return { csvName: name, text: inflateRawSync(data).toString("utf8") };
    throw new SecFileError(`unsupported ZIP compression method ${method}`);
  }
  throw new SecFileError("ZIP holds no CSV file");
}
