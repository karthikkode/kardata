export type FeeTier = {
  from: number; to: number | null; rate_pct: number;
  from_inclusive?: boolean | null; to_inclusive?: boolean | null;
};
export type TierMethod = "marginal" | "cliff";

export function effectiveFee(input: {
  tiers: FeeTier[]; method: TierMethod; balance: number;
  minimumAnnualFee?: number | null; minimumAccountSize?: number | null;
}) {
  const { balance, tiers, method, minimumAnnualFee, minimumAccountSize } = input;
  if (!Number.isFinite(balance) || balance <= 0 || (minimumAccountSize != null && balance < minimumAccountSize)) return null;
  if (!tiers.length || (method === "marginal" && tiers[0]?.from !== 0) ||
      (minimumAnnualFee != null && (!Number.isFinite(minimumAnnualFee) || minimumAnnualFee < 0))) return null;
  let total = 0;
  let reached = false;
  for (const [i, tier] of tiers.entries()) {
    const previous = tiers[i - 1];
    const next = tiers[i + 1];
    const gap = previous?.to == null ? null : Math.round((tier.from - previous.to) * 100) / 100;
    if (!Number.isFinite(tier.from) || tier.from < 0 ||
      (tier.to !== null && (!Number.isFinite(tier.to) || tier.to <= tier.from)) ||
      !Number.isFinite(tier.rate_pct) || tier.rate_pct < 0 || tier.rate_pct > 100 ||
      (previous && (gap === null || (gap !== 0 && gap !== 0.01 && gap !== 1)))) return null;
    // "First $1M, next $2M" has a continuous marginal breakpoint.
    // Whole-dollar/cent printed bands may put the next lower bound just above it.
    if (method === "marginal") {
      total += Math.max(0, Math.min(balance, tier.to ?? balance) - (previous?.to ?? tier.from)) * tier.rate_pct / 100;
    }
    const lowerInclusive = tier.from_inclusive ?? (!previous || gap !== 0 || previous.to_inclusive === false);
    const upperInclusive = tier.to_inclusive ?? next?.from_inclusive !== true;
    const covers = (balance > tier.from || (lowerInclusive && balance === tier.from)) &&
      (tier.to === null || balance < tier.to || (upperInclusive && balance === tier.to));
    if (covers) {
      if (reached) return null;
      reached = true;
      if (method === "cliff") total = balance * tier.rate_pct / 100;
    }
  }
  if (!reached) return null;
  const dollars = Math.round(Math.max(total, minimumAnnualFee ?? 0) * 100) / 100;
  return { dollars, rate_pct: dollars / balance * 100 };
}
