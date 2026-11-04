export type FeeTier = { from: number; to: number | null; rate_pct: number };
export type TierMethod = "marginal" | "cliff";

export function effectiveFee(input: {
  tiers: FeeTier[]; method: TierMethod; balance: number;
  minimumAnnualFee?: number | null; minimumAccountSize?: number | null;
}) {
  const { balance, tiers, method, minimumAnnualFee, minimumAccountSize } = input;
  if (!Number.isFinite(balance) || balance <= 0 || (minimumAccountSize != null && balance < minimumAccountSize)) return null;
  if (!tiers.length || tiers[0]?.from !== 0 || (minimumAnnualFee != null && (!Number.isFinite(minimumAnnualFee) || minimumAnnualFee < 0))) return null;
  let total = 0;
  let reached = false;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    if (!Number.isFinite(tier.from) || tier.from < 0 ||
      (tier.to !== null && (!Number.isFinite(tier.to) || tier.to <= tier.from)) ||
      !Number.isFinite(tier.rate_pct) || tier.rate_pct < 0 || tier.rate_pct > 100 ||
      (i > 0 && tiers[i - 1]?.to !== tier.from)) return null;
    if (method === "marginal") total += Math.max(0, Math.min(balance, tier.to ?? balance) - tier.from) * tier.rate_pct / 100;
    if (!reached && (tier.to === null || balance <= tier.to)) {
      reached = true;
      if (method === "cliff") total = balance * tier.rate_pct / 100;
    }
  }
  if (!reached) return null;
  const dollars = Math.round(Math.max(total, minimumAnnualFee ?? 0) * 100) / 100;
  return { dollars, rate_pct: dollars / balance * 100 };
}
