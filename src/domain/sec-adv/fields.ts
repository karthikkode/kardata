import { parseCountField, parseMoneyField, parseSecDate } from "../../lib/sec/parse.js";

const letters = "abcdefghijklmn".split("");
const clientKeys = [
  "individuals", "hnw", "banks", "investment_companies", "business_development_companies",
  "pooled_vehicles", "pension", "charities", "governments", "other_advisers",
  "insurers", "sovereign_funds", "businesses", "other",
];

type Kind = "number" | "usd" | "text" | "date" | "bool" | "text_list";
type Field = { key: string; column: string; kind: Kind };

const field = (key: string, column: string, kind: Kind): Field => ({ key, column, kind });
const flags = (prefix: string, columns: string[]): Field[] =>
  columns.map(column => field(`sec_adv.${prefix}_${column.slice(2).match(/\d+/g)?.join("_") ?? ""}`.replace(/_$/, ""), column, "bool"));
const numbered = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}(${i + 1})`);

export const SNAPSHOT_FIELDS: Field[] = [
  field("financials.employees", "5A", "number"),
  ...["advisory_staff", "broker_dealer_representatives", "state_adviser_representatives",
    "other_firm_adviser_representatives", "insurance_agents", "outside_solicitors"]
    .map((key, i) => field(`sec_adv.${key}`, `5B(${i + 1})`, "number")),
  field("sec_adv.planning_clients_range", "5H", "text"),
  field("sec_adv.planning_clients", "5H-If more than 500, how many", "number"),
  ...["a", "b", "c", "d", "e"].map(letter => field(`sec_adv.marketing_1_${letter}`, `5L(1)(${letter})`, "bool")),
  ...flags("marketing", ["5L(2)", "5L(3)", "5L(4)"]),
  ...flags("business", numbered("6A", 14)),
  field("sec_adv.business_other", "6A(14)-Other", "text"),
  field("sec_adv.other_business_primary", "6B(1)", "bool"),
  field("sec_adv.other_business_description", "6B(2)", "text"),
  field("sec_adv.other_products_services", "6B(3)", "text"),
  field("sec_adv.has_website_or_social", "1I", "bool"),
  field("sec_adv.website_count", "Total Number of Website Addresses", "number"),
  ...letters.flatMap((letter, i) => [
    field(`${["a", "b", "g"].includes(letter) ? "firm" : "sec_adv"}.client_${clientKeys[i]}`, `5D(${letter})(1)`, "number"),
    field(`sec_adv.aum_${clientKeys[i]}`, `5D(${letter})(3)`, "usd"),
  ]),
  field("firm.client_total", "5D(·)(1)", "number"),
  field("firm.client_total_low", "5D(·)(1), hidden categories assumed 1 client", "number"),
  field("firm.client_total_high", "5D(·)(1), hidden categories assumed 4 clients", "number"),
  field("sec_adv.discretionary_aum", "5F(2)(a)", "usd"),
  field("sec_adv.nondiscretionary_aum", "5F(2)(b)", "usd"),
  field("firm.regulatory_aum", "5F(2)(c)", "usd"),
  field("sec_adv.discretionary_accounts", "5F(2)(d)", "number"),
  field("sec_adv.nondiscretionary_accounts", "5F(2)(e)", "number"),
  field("firm.accounts", "5F(2)(f)", "number"),
  ...flags("compensation", numbered("5E", 7)),
  field("firm.compensation_types", "5E(1)–(7)", "text_list"),
  field("sec_adv.compensation_other", "5E(7)-Other", "text"),
  ...flags("services", numbered("5G", 12)),
  field("sec_adv.services_other", "5G(12)-Other", "text"),
  field("sec_adv.wrap_program", "5I(1)", "bool"),
  field("sec_adv.wrap_sponsor", "5I(2)(a)", "bool"),
  field("sec_adv.wrap_manager", "5I(2)(b)", "bool"),
  field("sec_adv.wrap_sponsor_and_manager", "5I(2)(c)", "bool"),
  field("sec_adv.wrap_program_count", "5.I.(2) - Total number of wrap fee programs", "number"),
  field("sec_adv.additional_offices", "Total number of offices, other than your Principal Office and place of business", "number"),
  field("sec_adv.main_office_state", "Main Office State", "text"),
  field("sec_adv.main_office_private", "Main Office Private Residence Flag", "bool"),
  field("firm.filing_date", "Latest ADV Filing Date", "date"),
  field("firm.registration_status", "SEC Current Status", "text"),
  field("firm.firm_type", "Firm Type", "text"),
  field("firm.sec_number", "SEC#", "text"),
  ...["A", "B"].flatMap(section => [
    field(`sec_adv.custody_${section.toLowerCase()}_funds`, `9${section}(1)(a)`, "bool"),
    field(`sec_adv.custody_${section.toLowerCase()}_securities`, `9${section}(1)(b)`, "bool"),
    field(`sec_adv.custody_${section.toLowerCase()}_amount`, `9${section}(2)(a)`, "usd"),
    field(`sec_adv.custody_${section.toLowerCase()}_clients`, `9${section}(2)(b)`, "number"),
  ]),
  ...flags("custody_reporting", numbered("9C", 4)),
  ...flags("qualified_custodian", numbered("9D", 2)),
  field("sec_adv.custody_unqualified_opinion", "9C Unqual Opinion", "bool"),
  field("sec_adv.custody_exam_month", "9E", "text"),
  field("sec_adv.qualified_custodian_count", "9F", "number"),
  field("sec_adv.custody_total", "Total Custody Amount", "usd"),
  field("sec_adv.succession", "4A", "bool"),
  field("sec_adv.succession_date", "4B", "date"),
  field("sec_adv.acquired_firm", "Acquired Firm", "text"),
  field("sec_adv.acquired_firm_count", "Total Number of Acquired Firms", "number"),
  ...flags("affiliation", numbered("7A", 16)),
  field("sec_adv.adviser_affiliates", "Count of IA Affiliates", "number"),
  field("sec_adv.dual_affiliates", "Count of IA/BD Affiliates", "number"),
  field("sec_adv.broker_dealer_affiliates", "Count of BD Affiliates", "number"),
  field("sec_adv.has_disclosure", "11", "bool"),
];

export function advBoolean(value: string | undefined): boolean | null {
  switch (value?.trim().toLowerCase()) {
    case "y": case "yes": case "true": case "1": case "x": return true;
    case "n": case "no": case "false": case "0": return false;
    default: return null;
  }
}

const COMPENSATION = ["percentage_of_aum", "hourly", "subscription", "fixed", "commissions", "performance", "other"];

export const CLIENT_BOUNDS_VERSION = 1;
export const CLIENT_BOUND_KEYS = ["firm.client_total_low", "firm.client_total_high"];

/** Missing unsuppressed categories remain unknown, even with no reported AUM. */
export function clientTotals(raw: Record<string, string>) {
  let low = 0;
  let high = 0;
  let hidden = false;
  for (const letter of letters) {
    const flag = raw[`5D(${letter})(2)`];
    if (advBoolean(flag) === true || /fewer than 5/i.test(flag ?? "")) {
      low += 1;
      high += 4;
      hidden = true;
    } else {
      const count = parseCountField(raw[`5D(${letter})(1)`]);
      if (count === null || count < 0) return { exact: null, low: null, high: null };
      low += count;
      high += count;
    }
  }
  return { exact: hidden ? null : low, low, high };
}

export function snapshotValues(raw: Record<string, string>) {
  const counts = new Map(letters.map(letter => {
    const suppressed = raw[`5D(${letter})(2)`];
    const count = advBoolean(suppressed) === true || /fewer than 5/i.test(suppressed ?? "")
      ? null : parseCountField(raw[`5D(${letter})(1)`]);
    return [`5D(${letter})(1)`, count];
  }));
  const totals = clientTotals(raw);
  return SNAPSHOT_FIELDS.flatMap(def => {
    const rawValue = raw[def.column]?.trim();
    let value: unknown;
    if (def.key === "firm.client_total") value = totals.exact;
    else if (def.key === "firm.client_total_low") value = totals.low;
    else if (def.key === "firm.client_total_high") value = totals.high;
    else if (counts.has(def.column)) value = counts.get(def.column);
    else if (def.kind === "text_list") {
      const flags = COMPENSATION.map((_, index) => advBoolean(raw[`5E(${index + 1})`]));
      value = flags.every(flag => flag !== null) && flags.some(Boolean) ? COMPENSATION.filter((_, index) => flags[index]) : null;
    } else if (def.key === "sec_adv.planning_clients") value = parseCountField(rawValue) ?? parseCountField(raw["5H"]);
    else if (def.kind === "bool") value = advBoolean(rawValue);
    else if (def.kind === "number") value = parseCountField(rawValue);
    else if (def.kind === "usd") value = parseMoneyField(rawValue);
    else if (def.kind === "date") value = parseSecDate(rawValue) ?? (rawValue && /^\d{4}-\d\d-\d\d$/.test(rawValue) ? rawValue : null);
    else value = rawValue || null;
    return value === null || value === undefined || (typeof value === "number" && value < 0) ? [] : [{ ...def, value }];
  });
}
