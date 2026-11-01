import type { BucketRule } from "./rules.js";

/**
 * RIA ICP signals (Stage 5.7 B6): the 7 signals of docs/sectors/ria/icp.md
 * section 4 with routes and windows. Playbook exception (D-69): this
 * module and prompts/icp-ria-v1 may name filing/fee terms. Exclusions for
 * ria come from the preflight reason keys, not judge buckets.
 */

/**
 * The deep-research judge scores these 7. The other five signals in
 * RIA_SIGNAL_RULES are light-path only (code-computed) and never asked
 * of the judge.
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

/** Sheet order for the top-3 display and the lead (call-opener) signal. */
export const RIA_LEAD_PRIORITY = [
  "regulatory_disclosure",
  "fee_problem",
  "recent_deal",
  "outside_managers",
  "alternatives",
  "multi_custodian",
  "custody_work",
  "ops_hiring",
  "many_services",
  "tool_sprawl",
  "heavy_book",
  "growth",
  "fee_complexity",
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
    question: "Did AUM grow 30% or more in a year, or staff 20% or more (at least 2 people)? State both dated numbers.",
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
    key: "heavy_book",
    label: "Heavy book",
    question: "Accounts or clients per employee in the top quarter of its size group (P or R)? State both numbers.",
    routes: [{ factKeys: ["firm.accounts", "firm.client_total", "financials.employees"] }],
  },
  {
    key: "many_services",
    label: "Many services",
    question: "Three or more service lines (planning, tax, insurance, retirement plan consulting, trusts/estates, investment management)?",
    routes: [{ factKeys: ["ria.services"] }],
  },
  {
    key: "outside_managers",
    label: "Outside managers",
    question: "Uses outside managers, sub-advisers, wrap programs, model or TAMP providers? Quote the brochure.",
    routes: [{ factKeys: ["ria.outside_managers", "ria.sub_advisers", "ria.wrap_programs", "ria.tamp_providers"] }],
  },
  {
    key: "alternatives",
    label: "Alternatives / private funds",
    question: "Advises private funds or alternatives? Quote the brochure or state the Schedule D fund count.",
    routes: [{ factKeys: ["ria.private_funds", "firm.private_fund_count"] }],
  },
  {
    key: "custody_work",
    label: "Custody work",
    question: "Custody work beyond safekeeping: standing letters of authorization, third-party money movement, surprise exams? Quote Item 15.",
    routes: [{ factKeys: ["ria.custody_sloa", "ria.custody_exam"] }],
  },
  {
    key: "regulatory_disclosure",
    label: "Regulatory disclosure",
    question: "Does Part 1 Item 11 report any disclosure event (any Item 11 answer Yes)?",
    routes: [{ factKeys: ["firm.regulatory_disclosure"] }],
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

/** Rules the deep-research judge sees (the original 7 signals). */
export const RIA_JUDGE_RULES = RIA_RULES_LIST.filter((r) => (RIA_SIGNAL_KEYS as readonly string[]).includes(r.key)) as unknown as BucketRule[];
