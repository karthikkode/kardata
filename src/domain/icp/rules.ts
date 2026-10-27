/**
 * The ICP check's vocabulary (Stage 5.5). The business rules live in
 * docs/business/icp.md (section 2 exclusions, section 5 signals) and
 * docs/business/evidence-rules.md; this module only names them and says
 * where each one is found in stored data. Change the docs first.
 */

export const SIGNAL_KEYS = ["channels", "hiring", "revenue_left", "review_pain", "recent_change", "tool_sprawl"] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export const EXCLUSION_KEYS = ["data_team", "parent_company", "not_d2c"] as const;
export type ExclusionKey = (typeof EXCLUSION_KEYS)[number];

/** A flag, not an exclusion (icp.md section 2): keeps its layer, goes last. */
export const FLAG_KEYS = ["tech_team"] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

export type BucketKey = SignalKey | ExclusionKey | FlagKey;

export interface Route {
  /** Fact keys (current facts) that feed the bucket. */
  factKeys?: string[];
  /** Fact key prefixes (for open-ended keys such as financials.parent_*). */
  keyPrefixes?: string[];
  /** Record types that feed the bucket. */
  recordTypes?: string[];
  /** Only records whose text matches (job titles, leader titles). */
  match?: RegExp;
  /** Only records whose numeric rating is at or below this (review pain). */
  maxRating?: number;
  /** Freshness window in days (evidence-rules.md "date it"); none = any date. */
  windowDays?: number;
  /** The date must be stated by the source (review date, event date), not the day we saw it. */
  statedDate?: boolean;
}

export interface BucketRule {
  key: BucketKey;
  label: string;
  /** What the judge decides (icp.md wording, shortened). */
  question: string;
  routes: Route[];
  /**
   * Research-note items (doc_only: quoted in the agent's notes, not matched
   * to a stored page) may support this answer. True for exclusions and
   * flags: wrongly skipping a company costs one prospect, while pitching a
   * listed group's brand breaks icp.md. Signals become claims to prospects,
   * so they stay grounded only (evidence-rules.md).
   */
  allowNotes?: boolean;
}

const DATA_TITLE = /\b(data|analytics|analyst|insights?|business intelligence|bi)\b/i;
const TECH_TITLE = /\b(engineer(ing)?|developer|cto|software|devops|technology)\b/i;
const OWNER_TITLE = /\b(founder|co-?founder|ceo|chief executive|general manager|gm|managing director|president|owner)\b/i;

/** icp.md section 5: job posts older than 6 months, reviews older than 12, funding older than 18. */
export const HIRING_WINDOW_DAYS = 183;
export const REVIEW_WINDOW_DAYS = 365;
export const CHANGE_WINDOW_DAYS = 548;

export const SIGNAL_RULES: BucketRule[] = [
  {
    key: "channels",
    label: "Sells across channels",
    question: "Does it sell on Amazon, or through 3+ retailers, or wholesale, besides its own store?",
    routes: [
      { recordTypes: ["retailer"] },
      {
        factKeys: [
          "business_model.marketplace",
          "business_model.wholesale",
          "business_model.wholesale_terms",
          "business_model.retail_presence",
          "marketing.retail_distribution",
        ],
      },
    ],
  },
  {
    key: "hiring",
    label: "Hiring for manual work",
    question:
      "Is it hiring for manual operational work (ops, inventory, planning, analyst, Excel-heavy roles)? Read the role titles and quotes.",
    routes: [
      { recordTypes: ["job_posting"], windowDays: HIRING_WINDOW_DAYS },
      { factKeys: ["hiring.open_roles", "hiring.open_roles_by_department"], windowDays: HIRING_WINDOW_DAYS },
    ],
  },
  {
    key: "revenue_left",
    label: "Revenue left on the table",
    question:
      "Is revenue left on the table: products bought again but no subscription, best sellers out of stock, or heavy constant discounting?",
    routes: [
      {
        factKeys: [
          "business_model.subscription",
          "business_model.subscription_terms",
          "marketing.promo_cadence",
          "marketing.max_discount_depth",
          "marketing.promo_code",
        ],
      },
    ],
  },
  {
    key: "review_pain",
    label: "Customer pain in reviews",
    question: "Do dated reviews from the last 12 months complain about shipping, stock or orders? Quote them.",
    routes: [
      { recordTypes: ["review"], maxRating: 3, windowDays: REVIEW_WINDOW_DAYS, statedDate: true },
      { recordTypes: ["review_theme"] },
    ],
  },
  {
    key: "recent_change",
    label: "A recent change",
    question: "In the last 18 months: funding, a new retailer, a new channel, or a rebrand?",
    routes: [
      { recordTypes: ["funding_event", "company_event", "news_item"], windowDays: CHANGE_WINDOW_DAYS, statedDate: true },
      { factKeys: ["financials.last_raise_date"], windowDays: CHANGE_WINDOW_DAYS, statedDate: true },
    ],
  },
  {
    key: "tool_sprawl",
    label: "Tool sprawl",
    question: "Are 2+ tools doing the same job, or 4+ ad networks running?",
    routes: [{ factKeys: ["marketing.tool", "marketing.channel_active"] }],
  },
];

export const EXCLUSION_RULES: BucketRule[] = [
  {
    key: "data_team",
    label: "Has a data team",
    allowNotes: true,
    question: "Are there 2+ data job titles, or any Head/VP of Data, among its staff or open roles?",
    routes: [{ recordTypes: ["leader", "job_posting"], match: DATA_TITLE }, { factKeys: ["hiring.open_roles_by_department"] }],
  },
  {
    key: "parent_company",
    label: "Owned by a listed or multi-brand company",
    allowNotes: true,
    question:
      "Is it owned by a listed or multi-brand company? It stays in only if a source shows the brand has its own founder, CEO or GM who makes decisions. PE funds and small holding companies are kept.",
    routes: [
      {
        factKeys: [
          "financials.ownership",
          "financials.funding_status",
          "decisions.acquirer_name",
          "decisions.acquisition_date",
          "decisions.strategic_investor_name",
          "decisions.outside_investment",
          "decisions.legal_entity_name",
        ],
        keyPrefixes: ["financials.parent_", "decisions.parent_", "decisions.acquir", "financials.ownership"],
      },
      { recordTypes: ["leader"], match: OWNER_TITLE },
    ],
  },
  {
    key: "not_d2c",
    label: "Not a real D2C brand",
    allowNotes: true,
    question: "Is it not a real D2C brand (clinic, salon, spa, distributor, agency, dead or parked site)?",
    routes: [{ factKeys: ["business_model.dtc_store", "decisions.online_store_active_oct_2026"] }],
  },
];

export const FLAG_RULES: BucketRule[] = [
  {
    key: "tech_team",
    label: "Has a tech team",
    allowNotes: true,
    question: "Does it employ engineers (but no data roles)?",
    routes: [{ recordTypes: ["leader", "job_posting"], match: TECH_TITLE }],
  },
];

export const ALL_RULES: BucketRule[] = [...SIGNAL_RULES, ...EXCLUSION_RULES, ...FLAG_RULES];
