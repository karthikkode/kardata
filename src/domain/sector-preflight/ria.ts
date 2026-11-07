import type { RiaThresholds } from "./profile.js";

/**
 * Rule-based RIA preflight (Stage 5.7 B3): no LLM. Eligibility from the
 * imported SEC facts per docs/sectors/ria/icp.md sections 1-2.
 */

export type RiaReason = "not_active" | "not_us" | "large" | "no_staff" | "hold_not_wealth";
export type RiaDecision = "Accept" | "Hold" | "Reject";
export type RiaTier = 0 | 1 | 2;

export interface RiaFacts {
  aum: number | null;
  employees: number | null;
  wealthShare: number | null;
  firmType: string | null;
  registrationStatus: string | null;
  country: string | null;
  state?: string | null;
  inNewestFile?: boolean;
}

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

export interface RiaVerdict {
  eligible: boolean;
  reason: RiaReason | null;
  decision: RiaDecision;
  tier: RiaTier | null;
  detail: string;
}

const US_NAMES = new Set(["united states", "united states of america", "usa", "us", "u.s.", "u.s.a."]);

export function isUsCountry(country: string | null, state?: string | null): boolean {
  const c = (country ?? "").trim().toLowerCase();
  if (c !== "") return US_NAMES.has(c);
  // Blank country with a US state (or US address state) is US (follow-up fix).
  const s = (state ?? "").trim().toUpperCase();
  return s !== "" && US_STATES.has(s);
}

export function evaluateRia(facts: RiaFacts, t: RiaThresholds): RiaVerdict {
  const reject = (reason: RiaReason, detail: string): RiaVerdict =>
    ({ eligible: false, decision: "Reject", tier: null, reason, detail });
  const firmType = (facts.firmType ?? "").toLowerCase();
  const status = (facts.registrationStatus ?? "").trim().toLowerCase();
  if (facts.inNewestFile === false || firmType.includes("exempt") || !["approved", "active"].includes(status)) {
    return reject("not_active", facts.inNewestFile === false ? "missing from newest SEC file" : `registration ${facts.registrationStatus ?? "unknown"}; type ${facts.firmType ?? "unknown"}`);
  }
  if (!isUsCountry(facts.country, facts.state)) return reject("not_us", `main office country ${facts.country ?? "unknown"}`);
  if ((facts.aum !== null && facts.aum > t.maxAum) || (facts.employees !== null && facts.employees > t.maxEmployees)) {
    return reject("large", `AUM ${facts.aum ?? "?"} / employees ${facts.employees ?? "?"} over the cap`);
  }
  if (facts.employees === null || facts.employees < t.minEmployees) return reject("no_staff", `employees ${facts.employees ?? "unknown"}`);
  if (facts.wealthShare === null || facts.wealthShare < t.minWealthShare) {
    return { eligible: false, decision: "Hold", tier: null, reason: "hold_not_wealth", detail: `wealth share ${facts.wealthShare ?? "unknown"} under ${t.minWealthShare}` };
  }
  const tier: RiaTier = facts.employees === 1 ? 0
    : (facts.aum ?? 0) >= t.tier2MinAum && facts.employees >= t.tier2MinEmployees ? 2 : 1;
  return { eligible: true, decision: "Accept", tier, reason: null, detail: `Tier ${tier}: AUM ${facts.aum ?? "unknown"}, employees ${facts.employees}` };
}

export function riaStoredReason(verdict: RiaVerdict): string {
  return verdict.decision === "Accept" ? `tier:${verdict.tier}` : verdict.reason!;
}
