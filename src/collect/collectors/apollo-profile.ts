import type { AddFactItem } from "../../domain/research/facts.js";
import { findApolloImportSource } from "../../domain/research/sources.js";
import type { Collector, CollectorCtx } from "./types.js";
import { writeExtract, writeFacts } from "./util.js";

function money(value: string | null): string {
  if (value === null) return "unknown";
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : value;
}

// Apollo revenue/funding estimates are USD-denominated whole dollars.
function usd(value: string | null): { amount: number; currency: string } | null {
  if (value === null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? { amount, currency: "USD" } : null;
}

export const apolloProfileCollector: Collector = {
  name: "apollo_profile",
  areas: ["financials"],
  // No network: Apollo proxies already on the company row.
  run: async (ctx: CollectorCtx) => {
    const e = ctx.effective;
    const lines = [
      `Annual revenue: ${money(e.annualRevenue)} (Apollo estimate)`,
      `Total funding: ${money(e.totalFunding)} (Apollo estimate)`,
      `Latest funding: ${e.latestFunding ?? "unknown"}${e.latestFundingAmount ? ` — ${money(e.latestFundingAmount)} (Apollo estimate)` : " (Apollo estimate)"}`,
      `Employees: ${e.employees ?? "unknown"} (Apollo estimate)`,
      `Founded: ${e.foundedYear ?? "unknown"} (Apollo estimate)`,
    ];
    const hasAny =
      e.annualRevenue !== null ||
      e.totalFunding !== null ||
      e.latestFundingAmount !== null ||
      e.latestFunding !== null ||
      e.employees !== null ||
      e.foundedYear !== null;
    if (!hasAny) {
      return {
        outcomes: [
          { area: "financials", status: "not_found" as const, reason: "no Apollo financial proxies" },
        ],
      };
    }
    await writeExtract(ctx, "apollo_profile", "financials/apollo-estimates.md", "Apollo estimates", lines.join("\n"), []);
    const apolloSource = await findApolloImportSource(ctx.db, ctx.companyId);
    if (apolloSource) {
      const sourceIds = [apolloSource.id];
      const items: AddFactItem[] = [];
      const revenue = usd(e.annualRevenue);
      if (revenue !== null) {
        items.push({
          key: "financials.revenue_estimate",
          value: revenue,
          // Vendor estimate: never clean. The tier rule (D-55) later marks it
          // accepted or rejected against staff; until then it is unverified.
          qualifiers: { source: "apollo", estimate_kind: "vendor", estimate_status: "unverified" },
          sourceIds,
          confidence: "medium",
        });
      }
      const funding = usd(e.totalFunding);
      if (funding !== null) {
        items.push({ key: "financials.total_funding", value: funding, sourceIds, confidence: "medium" });
      }
      if (e.employees !== null) {
        items.push({
          key: "financials.employees",
          value: e.employees,
          qualifiers: { source: "apollo" },
          sourceIds,
          confidence: "medium",
        });
      }
      if (e.foundedYear !== null) {
        items.push({ key: "company.founded_year", value: e.foundedYear, sourceIds, confidence: "medium" });
      }
      await writeFacts(ctx, "apollo_profile", items);
    }
    return { outcomes: [{ area: "financials", status: "done" as const }] };
  },
};
