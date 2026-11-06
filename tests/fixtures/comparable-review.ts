import type { Passage } from "../../src/domain/benchmark/fee-extraction.js";

/** Entirely invented brochure evidence; no live filing text or identities. */
export function comparableFixture(options: { strategy?: boolean; minimum?: number; waivable?: boolean; twoReadings?: boolean; annualFloorConflict?: boolean; scope?: "diversified" | "style" | "balanced_row" | "asset_class" | "current_schedule" | "legacy" | "optional_services" | "product" | "institutional" | "adviser_channel";
  minimumKind?: "net_worth_target" | "relationship_preference" | "assets_or_net_worth" } = {}) {
  const scope = options.strategy ? "Separate accounts are available only through the Synthetic Growth Strategy." :
    "We provide general investment management services to individuals and families.";
  const scopes = {
    diversified: "Our schedule covers diversified and customized multi-asset portfolios, balanced accounts and equity accounts.",
    style: "Our firm-wide sustainability investing style is applied to customized portfolios of stocks, bonds and funds.",
    balanced_row: "Clients may use a balanced portfolio of stocks, bonds and cash under our ordinary management service.",
    asset_class: "We offer customized wealth management portfolios with stocks, bonds and cash for individuals and families.",
    current_schedule: "Our current diversified investment management schedule applies to accounts opened from July 2018 onward, including all new clients.",
    legacy: "Only existing clients who opened their accounts before January 2010 may use this grandfathered schedule.",
    optional_services: "Our standard schedule covers diversified portfolios. Optional specialized mandates and external managers are separately priced services.",
    product: "This schedule applies only to the Synthetic Product portfolio.",
    institutional: "This schedule is available only to institutional clients.",
    adviser_channel: "This schedule is available only through the adviser channel.",
  };
  const scopeText = options.scope ? scopes[options.scope] : scope;
  const minimum = options.minimumKind === "net_worth_target" ? "For our general services we target family net worth of $5,000,000." :
    options.minimumKind === "relationship_preference" ? "We prefer relationships with $5,000,000 of assets or the potential to reach that size." :
    options.minimumKind === "assets_or_net_worth" ? "We require $2,000,000 in managed assets or $20,000,000 net worth. We may waive this requirement." : options.minimum ? `The minimum account size is $${options.minimum.toLocaleString("en-US")}.${options.waivable ? " We may waive this minimum." : ""}` :
    "We do not impose a minimum account size for these services.";
  const feeText = options.scope === "balanced_row" ? "Investment strategies: Stock mandates. Large growth portfolios: 0.9%. Balanced multi-asset portfolios: 0.7% on all assets in the account." :
    options.scope === "asset_class" ? "The stock holdings schedule charges 1% on stock assets. A separate bond holdings schedule charges 0.4% on bond assets." :
    options.twoReadings ? "Published annual fee bands: $0–$500,000: 2%; $500,000 and above: 1%." :
    "The annual investment management fee is 1% of assets.";
  const texts = [`Item 4 Advisory Business\n${scopeText}`, `Item 5 Fees and Compensation\n${feeText}`,
    `Item 7 Types of Clients\n${minimum}${options.annualFloorConflict ? " Our annual advisory fee minimum is $18,000, which may be waived." : ""}`];
  const passages: Passage[] = texts.map((text, i) => ({ ref: `physical-${i + 4}`, page: i + 4, text, kind: "firm",
    sourceId: "00000000-0000-4000-8000-000000000001", documentId: "00000000-0000-4000-8000-000000000002", date: "2026-01-01" }));
  const cite = (index: number, quote: string) => ({ ref: passages[index]!.ref, page: passages[index]!.page!, quote });
  const category = options.strategy ? "strategy" as const : options.scope === "asset_class" ? "asset_class" as const : options.scope === "product" ? "product" as const :
    ["institutional", "adviser_channel", "legacy"].includes(options.scope ?? "") ? "client_type" as const : "general" as const;
  const kind = options.minimumKind === "assets_or_net_worth" ? "account_minimum" as const :
    options.minimumKind ?? (options.minimum ? "account_minimum" as const : "none_stated" as const);
  const answer = {
    scope: { category, explanation: options.strategy ? "Named strategy restriction in Item 4" : options.scope === "asset_class" ? "Selected rates price only stock assets, despite the diversified firm services" : "General individual service",
      evidence: options.scope === "asset_class" ? cite(1, "The stock holdings schedule charges 1% on stock assets.") : cite(0, scopeText) },
    minimum: { kind, amount: options.minimumKind === "assets_or_net_worth" ? 2_000_000 : options.minimumKind ? 5_000_000 : options.minimum ?? null,
      waivable: options.minimumKind === "assets_or_net_worth" || (options.waivable ?? false), explanation: options.minimum ? "Account minimum remains applicable even if waivable" : "Explicitly no account minimum",
      evidence: cite(2, minimum) },
    pricing: { status: options.annualFloorConflict ? "contradicted" as const : "supported" as const,
      explanation: options.annualFloorConflict ? "Stored annual prices below the stated annual minimum and a missing annual-floor input cannot be used unconditionally" : "Existing price inputs are supported by the ordinary advisory schedule",
      evidence: options.annualFloorConflict ? cite(2, "Our annual advisory fee minimum is $18,000, which may be waived.") : cite(1, feeText) },
    sections: { item4: cite(0, texts[0]!), item5: cite(1, texts[1]!), item7: cite(2, texts[2]!) },
  };
  return { passages, answer, context: { feeFactId: "synthetic-fee", inputHash: "synthetic-input", complete: true, gaps: [] as string[] } };
}
