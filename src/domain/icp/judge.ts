import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MIN_CONTACT_SCORE, REVENUE_FLOOR, type ContactStatus } from "../tiering.js";
import type { EvidenceItem, EvidencePack } from "./evidence.js";
import {
  EXCLUSION_RULES,
  FLAG_RULES,
  SIGNAL_RULES,
  type BucketKey,
  type BucketRule,
  type ExclusionKey,
  type FlagKey,
  type SignalKey,
} from "./rules.js";

/**
 * The ICP judge (Stage 5.5 Step 2): Muse reads the evidence pack and says
 * which signals and exclusions it shows; the server checks every citation
 * and decides the score and status. The model never sets the score.
 */

export const ICP_PROMPT_VERSION = "icp-v3";

function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "prompts", ICP_PROMPT_VERSION);
}

const VERDICTS = ["yes", "no", "unknown"] as const;
type Verdict = (typeof VERDICTS)[number];

function answerSchema(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const extraKeys = Object.keys(extra);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: [...VERDICTS] },
      evidence_refs: { type: "array", items: { type: "string" } },
      observation: { type: "string" },
      ...extra,
    },
    required: ["verdict", "evidence_refs", "observation", ...extraKeys],
  };
}

function group(rules: BucketRule[], special: Partial<Record<BucketKey, Record<string, unknown>>> = {}): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(rules.map((r) => [r.key, answerSchema(special[r.key])])),
    required: rules.map((r) => r.key),
  };
}

/** JSON schema for --output-schema, built from the rule keys so they never drift. */
export function icpSchema(): string {
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    properties: {
      signals: group(SIGNAL_RULES),
      exclusions: group(EXCLUSION_RULES, {
        parent_company: { own_decision_maker: { type: "string", enum: [...VERDICTS] } },
      }),
      flags: group(FLAG_RULES),
    },
    required: ["signals", "exclusions", "flags"],
  });
}

const answer = z.object({
  verdict: z.enum(VERDICTS),
  evidence_refs: z.array(z.string()),
  observation: z.string(),
});
type Answer = z.infer<typeof answer>;

function groupParser<K extends string>(keys: readonly K[], shape: z.ZodTypeAny = answer) {
  return z.object(Object.fromEntries(keys.map((k) => [k, shape])) as Record<K, typeof shape>);
}

const judgementSchema = z.object({
  signals: groupParser(SIGNAL_RULES.map((r) => r.key as SignalKey)),
  exclusions: z.object({
    data_team: answer,
    parent_company: answer.extend({ own_decision_maker: z.enum(VERDICTS) }),
    not_d2c: answer,
  }),
  flags: groupParser(FLAG_RULES.map((r) => r.key as FlagKey)),
});
export type Judgement = {
  signals: Record<SignalKey, Answer>;
  exclusions: Record<Exclude<ExclusionKey, "parent_company">, Answer> & {
    parent_company: Answer & { own_decision_maker: Verdict };
  };
  flags: Record<FlagKey, Answer>;
};

export function parseJudgement(json: unknown): Judgement {
  const parsed = judgementSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`invalid icp judgement: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data as Judgement;
}

/** Independent judge calls per check; a verdict needs a majority of them. */
export const ICP_VOTES = 3;

function majority<A extends Answer>(answers: A[]): { answer: A; tally: string } {
  const counts = new Map<Verdict, number>();
  for (const a of answers) counts.set(a.verdict, (counts.get(a.verdict) ?? 0) + 1);
  const tally = VERDICTS.filter((v) => counts.has(v)).map((v) => `${v} ${counts.get(v)}`).join(", ");
  const need = Math.floor(answers.length / 2) + 1;
  const won = VERDICTS.find((v) => (counts.get(v) ?? 0) >= need);
  // No majority (for example yes/no/unknown): the evidence doesn't settle it.
  const pick = won ?? "unknown";
  const first = answers.find((a) => a.verdict === pick);
  const answer = first ?? ({ ...answers[0], verdict: "unknown", evidence_refs: [], observation: "The judges disagreed; not counted." } as A);
  return { answer, tally };
}

/**
 * Merges independent judgements question by question: each verdict is the
 * majority's (ties are unknown), with the refs and observation of the first
 * vote that gave it. Returns the tally per question for the check row.
 */
export function mergeJudgements(votes: Judgement[]): { judgement: Judgement; tallies: Record<string, string> } {
  if (votes.length === 0) throw new Error("no judgements to merge");
  const tallies: Record<string, string> = {};
  const merge = <K extends string, A extends Answer>(group: string, pick: (j: Judgement) => Record<K, A>): Record<K, A> => {
    const keys = Object.keys(pick(votes[0] as Judgement)) as K[];
    return Object.fromEntries(
      keys.map((k) => {
        const { answer, tally } = majority(votes.map((j) => pick(j)[k]));
        tallies[`${group}.${k}`] = tally;
        return [k, answer];
      }),
    ) as Record<K, A>;
  };
  const judgement: Judgement = {
    signals: merge("signals", (j) => j.signals),
    exclusions: merge("exclusions", (j) => j.exclusions) as Judgement["exclusions"],
    flags: merge("flags", (j) => j.flags),
  };
  return { judgement, tallies };
}

function itemLine(item: EvidenceItem): string {
  const parts = [`[${item.ref}] ${item.key}: ${item.value}`];
  if (item.quote) parts.push(`quote: "${item.quote}"`);
  parts.push(`${item.date} (${item.dateKind})`);
  if (item.origin === "notes") parts.push("from research notes, not matched to a stored page");
  if (item.url) parts.push(item.url);
  return `- ${parts.join(" | ")}`;
}

function section(rules: BucketRule[], pack: EvidencePack): string {
  return rules
    .map((rule) => {
      const items = pack.buckets[rule.key];
      const body = items.length > 0 ? items.map(itemLine).join("\n") : "- (no usable evidence stored)";
      return `### \`${rule.key}\`: ${rule.label}\n${rule.question}\n\n${body}`;
    })
    .join("\n\n");
}

function money(n: number | null): string {
  return n === null ? "unknown" : `$${Math.round(n).toLocaleString("en-US")}`;
}

export function buildIcpPrompt(pack: EvidencePack): string {
  const template = readFileSync(join(promptsDir(), "prompt.md"), "utf8");
  const company = [
    `- name: ${pack.company.name ?? "unknown"}`,
    `- domain: ${pack.company.domain ?? "unknown"}`,
    `- country: ${pack.company.country ?? "unknown"}`,
    `- staff: ${pack.company.employees ?? "unknown"}`,
  ].join("\n");
  const preflight = pack.preflight
    ? `${pack.preflight.businessType}, ${pack.preflight.primaryCategory}: ${pack.preflight.reason}`
    : "(none)";
  const revenue = `${money(pack.revenue.revenueUsed)} (${pack.revenue.revenueSource ?? "no source"})`;
  const fill: Record<string, string> = {
    company,
    preflight,
    revenue,
    signals: section(SIGNAL_RULES, pack),
    exclusions: section(EXCLUSION_RULES, pack),
    flags: section(FLAG_RULES, pack),
  };
  return Object.entries(fill).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(v), template);
}

// ---- The server's decision ----

export interface BucketResult {
  key: BucketKey;
  verdict: Verdict;
  /** Counted toward the score (signals) or applied (exclusions, flags). */
  counted: boolean;
  refs: string[];
  /** Cited refs that were not in the pack (dropped). */
  droppedRefs: string[];
  observation: string;
  note: string | null;
}

export interface IcpDecision {
  score: number;
  status: ContactStatus;
  exclusionReason: string | null;
  signals: BucketResult[];
  exclusions: BucketResult[];
  flags: BucketResult[];
}

function checkAnswer(key: BucketKey, a: Answer, pack: EvidencePack, all: Set<string>, notes: Set<string>): BucketResult {
  const own = new Set(pack.buckets[key].map((i) => i.ref));
  const rule = [...SIGNAL_RULES, ...EXCLUSION_RULES, ...FLAG_RULES].find((r) => r.key === key);
  const refs = a.evidence_refs.filter((r) => all.has(r));
  const droppedRefs = a.evidence_refs.filter((r) => !all.has(r));
  let counted = a.verdict === "yes";
  let note: string | null = null;
  if (counted && refs.length === 0) {
    counted = false;
    note = droppedRefs.length > 0 ? "cited evidence that is not in the pack" : "no evidence cited";
  } else if (counted && !refs.some((r) => own.has(r))) {
    counted = false;
    note = "no cited evidence belongs to this question";
  } else if (counted && !rule?.allowNotes && refs.every((r) => notes.has(r))) {
    counted = false;
    note = "only research-note evidence; signals need a checked source";
  }
  return { key, verdict: a.verdict, counted, refs, droppedRefs, observation: a.observation, note };
}

/** Verdict from a checked judgement (icp.md sections 2 and 5, problem-bar.md). */
export function decideIcp(pack: EvidencePack, judgement: Judgement): IcpDecision {
  const all = new Set(Object.values(pack.buckets).flatMap((items) => items.map((i) => i.ref)));
  const notes = new Set(Object.values(pack.buckets).flatMap((items) => items.filter((i) => i.origin === "notes").map((i) => i.ref)));
  const consumed = new Set<string>();
  const signals = SIGNAL_RULES.map((rule) => {
    const result = checkAnswer(rule.key, judgement.signals[rule.key as SignalKey], pack, all, notes);
    // Independence: a signal resting only on evidence another signal already
    // used is the same signal counted twice.
    if (result.counted && result.refs.every((r) => consumed.has(r))) {
      result.counted = false;
      result.note = "rests on the same evidence as an earlier signal";
    }
    if (result.counted) for (const r of result.refs) consumed.add(r);
    return result;
  });
  const exclusions = EXCLUSION_RULES.map((rule) => {
    const key = rule.key as ExclusionKey;
    const result = checkAnswer(key, judgement.exclusions[key], pack, all, notes);
    if (key === "parent_company" && result.counted) {
      const a = judgement.exclusions.parent_company;
      const owner = pack.buckets.parent_company.filter((i) => i.key === "leader").map((i) => i.ref);
      if (a.own_decision_maker === "yes" && result.refs.some((r) => owner.includes(r))) {
        result.counted = false;
        result.note = "kept: the brand has its own decision maker (D-28)";
      }
    }
    return result;
  });
  const flags = FLAG_RULES.map((rule) => checkAnswer(rule.key, judgement.flags[rule.key as FlagKey], pack, all, notes));
  const score = signals.filter((s) => s.counted).length;
  const applied = exclusions.find((e) => e.counted);
  let status: ContactStatus;
  let exclusionReason: string | null = null;
  if (applied) {
    status = "excluded";
    const label = EXCLUSION_RULES.find((r) => r.key === applied.key)?.label ?? applied.key;
    exclusionReason = `${label}: ${applied.observation}`.slice(0, 500);
  } else if (pack.revenue.revenueUsed !== null && pack.revenue.tier === null) {
    status = "excluded";
    exclusionReason = `below $${REVENUE_FLOOR / 1000}k revenue: not contacted`;
  } else {
    status = score >= MIN_CONTACT_SCORE ? "contactable" : "watchlist";
  }
  return { score, status, exclusionReason, signals, exclusions, flags };
}

/** No usable evidence at all: research is incomplete, and no Muse call is made. */
export function incompleteDecision(): IcpDecision {
  return {
    score: 0,
    status: "research_incomplete",
    exclusionReason: null,
    signals: [],
    exclusions: [],
    flags: [],
  };
}
