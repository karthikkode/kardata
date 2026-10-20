import type { Collector, CollectorCtx } from "./types.js";
import { writeExtract } from "./util.js";

function money(value: string | null): string {
  if (value === null) return "unknown";
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : value;
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
    return { outcomes: [{ area: "financials", status: "done" as const }] };
  },
};
