import type { BucketRule } from "./rules.js";

/**
 * RIA ICP signals (Stage 5.7 B6): the 7 signals of docs/sectors/ria/icp.md
 * section 4 with routes and windows. Playbook exception (D-69): this
 * module and prompts/icp-ria-v1 may name filing/fee terms. Exclusions for
 * ria come from the preflight reason keys, not judge buckets.
 */

export const RIA_SIGNAL_KEYS = [
  "fee_complexity",
  "recent_deal",
  "ops_hiring",
  "multi_custodian",
  "growth",
  "tool_sprawl",
  "fee_problem",
] as const;
export type RiaSignalKey = (typeof RIA_SIGNAL_KEYS)[number];

export const DEAL_WINDOW_DAYS = 548;
export const OPS_HIRING_WINDOW_DAYS = 183;
export const GROWTH_WINDOW_DAYS = 365;

const RIA_RULES_LIST = [
  {
    key: "fee_complexity",
    label: "Complex fees",
    question:
      "Are fees hard to bill right: tiered schedules with family grouping, negotiable fees, several fee options (percent plus flat or hourly), or billing in advance with prorating and refunds? Quote Item 5.",
    routes: [{ keyPrefixes: ["firm.fee", "financials.fee"] }],
  },
  {
    key: "recent_deal",
    label: "Recent deal",
    question: "Did it buy, merge with, or get bought by another firm in the last 18 months, with clients moved over?",
    routes: [
      { recordTypes: ["company_event"], windowDays: DEAL_WINDOW_DAYS, statedDate: true },
      { keyPrefixes: ["firm.deal", "firm.acquisition"] },
    ],
  },
  {
    key: "ops_hiring",
    label: "Hiring operations staff",
    question:
      "Is there a job post in the last 6 months for operations, billing, client service or onboarding staff? Adviser or sales posts do not count.",
    routes: [{ recordTypes: ["job_posting"], windowDays: OPS_HIRING_WINDOW_DAYS }],
  },
  {
    key: "multi_custodian",
    label: "Multiple custodians",
    question: "Does it use two or more custodians? Name them.",
    routes: [{ factKeys: ["firm.custodians"] }],
  },
  {
    key: "growth",
    label: "Growing fast",
    question: "Did AUM or staff grow 20% or more in a year, or did it open a new office? State both dated numbers.",
    routes: [{ factKeys: ["firm.growth"], recordTypes: ["company_event"], windowDays: GROWTH_WINDOW_DAYS, statedDate: true }],
  },
  {
    key: "tool_sprawl",
    label: "Several named systems",
    question:
      "Are several systems named (portfolio, billing, CRM, planning), or was there a system change? Name each system.",
    routes: [{ keyPrefixes: ["firm.system", "firm.software"] }],
  },
  {
    key: "fee_problem",
    label: "Fee or billing problem disclosed",
    question: "Is there a fee or billing disclosure, refund, or deficiency on fees in Part 1, Item 9, or an SEC order?",
    routes: [{ factKeys: ["firm.disclosure_flag"], keyPrefixes: ["firm.disclosure", "compliance."] }],
  },
];

export function riaLayer(score: number): number {
  return 8 - score;
}

export const RIA_SIGNAL_RULES = RIA_RULES_LIST as unknown as BucketRule[];
