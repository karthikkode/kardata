import type { Fees } from "./measures.js";
import { COMPARABLE_REVIEW_VERSION, type ComparableReview } from "./comparable-review.js";

/** The review never mutates extraction. Conditional prices are separate from peer inputs. */
export function comparableFeeGate(raw: Fees | null, review: ComparableReview | null, feeFactId?: string) {
  const empty = (status: string) => ({ fees: null, status, balances: null, minimum: null });
  if (!raw) return empty("no_primary_fee");
  if (!review || review.version !== COMPARABLE_REVIEW_VERSION || review.feeFactId !== feeFactId) return empty("unreviewed");
  if (review.outcome === "unclear" || review.scope.category === "unclear" || review.minimum.kind === "unclear") return empty("unclear");
  if (review.scope.category !== "general" || review.outcome === "fail") return empty("fail");
  const stated = review.minimum.kind === "account_minimum" ? review.minimum.amount : 0;
  if (stated === null || !Number.isFinite(stated) || stated < 0 || !review.scope.evidence || !review.minimum.evidence ||
    !review.sections.item4 || !review.sections.item5 || !review.sections.item7) return empty("unclear");
  const minimum = Math.max(raw.minimumAccountSize ?? 0, stated);
  const balances = { at1m: "available", at5m: "available" } as ComparableReview["balances"];
  for (const [key, balance] of [["at1m", 1_000_000], ["at5m", 5_000_000]] as const) {
    if (minimum > balance) balances[key] = review.minimum.waivable && stated === minimum ? "waiver_required" : "unavailable";
    else if (review.balances[key] !== "available") balances[key] = review.balances[key];
  }
  const scenario = (value: NonNullable<Fees["scenarios"]>["marginal"]) => value ? {
    at1m: balances.at1m === "available" ? value.at1m : null, at5m: balances.at5m === "available" ? value.at5m : null,
  } : null;
  const fees: Fees = { ...raw, minimumAccountSize: minimum || null,
    at1m: balances.at1m === "available" ? raw.at1m : null, at5m: balances.at5m === "available" ? raw.at5m : null,
    scenarios: raw.scenarios ? { marginal: scenario(raw.scenarios.marginal), cliff: scenario(raw.scenarios.cliff) } : raw.scenarios };
  return { fees, status: Object.values(balances).includes("waiver_required") ? "conditional" : "pass", balances, minimum };
}
