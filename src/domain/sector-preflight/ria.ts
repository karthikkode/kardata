import type { RiaThresholds } from "./profile.js";

/**
 * Rule-based RIA preflight (Stage 5.7 B3): no LLM. Eligibility from the
 * imported SEC facts per docs/sectors/ria/icp.md sections 1-2.
 */

export type RiaReason = "large" | "not_wealth" | "no_staff" | "exempt_or_inactive" | "not_us";
export type RiaGroup = "P" | "R";

export interface RiaFacts {
  aum: number | null;
  employees: number | null;
  wealthShare: number | null;
  firmType: string | null;
  registrationStatus: string | null;
  country: string | null;
}

export interface RiaVerdict {
  eligible: boolean;
  reason: RiaReason | null;
  group: RiaGroup | null;
  detail: string;
}

const US_NAMES = new Set(["united states", "united states of america", "usa", "us", "u.s.", "u.s.a."]);

export function isUsCountry(country: string | null): boolean {
  if (!country) return false;
  return US_NAMES.has(country.trim().toLowerCase());
}

export function evaluateRia(facts: RiaFacts, t: RiaThresholds): RiaVerdict {
  const firmType = (facts.firmType ?? "").toLowerCase();
  const status = (facts.registrationStatus ?? "").trim().toLowerCase();
  if (firmType.includes("exempt")) {
    return { eligible: false, reason: "exempt_or_inactive", group: null, detail: `exempt firm type (${facts.firmType})` };
  }
  if (status !== "" && status !== "approved" && status !== "active") {
    return { eligible: false, reason: "exempt_or_inactive", group: null, detail: `registration status ${facts.registrationStatus}` };
  }
  if (!isUsCountry(facts.country)) {
    return { eligible: false, reason: "not_us", group: null, detail: `main office country ${facts.country ?? "unknown"}` };
  }
  if ((facts.aum !== null && facts.aum > t.maxAum) || (facts.employees !== null && facts.employees > t.maxEmployees)) {
    return {
      eligible: false,
      reason: "large",
      group: null,
      detail: `AUM ${facts.aum ?? "?"} / employees ${facts.employees ?? "?"} over the cap`,
    };
  }
  if (facts.wealthShare === null || facts.wealthShare < t.minWealthShare) {
    return {
      eligible: false,
      reason: "not_wealth",
      group: null,
      detail: `wealth share ${facts.wealthShare === null ? "unknown" : facts.wealthShare.toFixed(2)} under ${t.minWealthShare}`,
    };
  }
  if (facts.employees === null || facts.employees < t.minEmployees) {
    return { eligible: false, reason: "no_staff", group: null, detail: `employees ${facts.employees ?? "unknown"} under ${t.minEmployees}` };
  }
  const group: RiaGroup = (facts.aum ?? 0) < t.groupSplitAum ? "P" : "R";
  return { eligible: true, reason: null, group, detail: `eligible group ${group} (AUM ${facts.aum ?? 0})` };
}

/** Stored eligibilityReason for an RIA verdict: the reason key, or group:P / group:R. */
export function riaStoredReason(verdict: RiaVerdict): string {
  if (verdict.eligible && verdict.group) return `group:${verdict.group}`;
  return verdict.reason ?? "not_wealth";
}
