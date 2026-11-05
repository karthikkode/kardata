import type { Passage } from "../../src/domain/benchmark/fee-extraction.js";

/** Entirely invented brochure evidence; no live filing text or identities. */
export function comparableFixture(options: { strategy?: boolean; minimum?: number; waivable?: boolean } = {}) {
  const scope = options.strategy ? "Separate accounts are available only through the Synthetic Growth Strategy." :
    "We provide general investment management services to individuals and families.";
  const minimum = options.minimum ? `The minimum account size is $${options.minimum.toLocaleString("en-US")}.${options.waivable ? " We may waive this minimum." : ""}` :
    "We do not impose a minimum account size for these services.";
  const texts = [`Item 4 Advisory Business\n${scope}`, "Item 5 Fees and Compensation\nThe annual investment management fee is 1% of assets.",
    `Item 7 Types of Clients\n${minimum}`];
  const passages: Passage[] = texts.map((text, i) => ({ ref: `physical-${i + 4}`, page: i + 4, text, kind: "firm",
    sourceId: "00000000-0000-4000-8000-000000000001", documentId: "00000000-0000-4000-8000-000000000002", date: "2026-01-01" }));
  const cite = (index: number, quote: string) => ({ ref: passages[index]!.ref, page: passages[index]!.page!, quote });
  const answer = {
    scope: { category: options.strategy ? "strategy" as const : "general" as const, explanation: options.strategy ? "Named strategy restriction in Item 4" : "General individual service",
      evidence: cite(0, scope) },
    minimum: { kind: options.minimum ? "account_minimum" as const : "none_stated" as const, amount: options.minimum ?? null,
      waivable: options.waivable ?? false, explanation: options.minimum ? "Account minimum remains applicable even if waivable" : "Explicitly no account minimum",
      evidence: cite(2, minimum) },
    sections: { item4: cite(0, texts[0]!), item5: cite(1, texts[1]!), item7: cite(2, texts[2]!) },
  };
  return { passages, answer, context: { feeFactId: "synthetic-fee", inputHash: "synthetic-input", complete: true, gaps: [] as string[] } };
}
