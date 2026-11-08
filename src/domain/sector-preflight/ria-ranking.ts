import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import { companyIcpChecks, companyVerdicts } from "../../db/schema.js";
import type { BucketResult } from "../icp/judge.js";
import type { RiaDecision, RiaTier } from "./ria.js";

export const heavyBookCache = new Map<string, { at: number; accountsP75: number; clientsP75: number }>();
export function clearHeavyBookCache(sectorId: string) {
  for (const key of heavyBookCache.keys()) if (key.startsWith(`${sectorId}:`)) heavyBookCache.delete(key);
}
export function p75(values: number[]): number {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))]!;
}
export interface TierBook { companyId: string; tier: RiaTier; accountsPer: number | null; clientsPer: number | null }
export function tierHeavyBooks(books: TierBook[]) {
  const byTier = new Map<RiaTier, { accounts: number; clients: number }>();
  for (const tier of [0, 1, 2] as const) {
    const mine = books.filter(b => b.tier === tier);
    byTier.set(tier, { accounts: p75(mine.flatMap(b => b.accountsPer === null ? [] : [b.accountsPer])),
      clients: p75(mine.flatMap(b => b.clientsPer === null ? [] : [b.clientsPer])) });
  }
  return new Map(books.map(b => {
    const threshold = byTier.get(b.tier)!;
    const counted = (b.accountsPer !== null && b.accountsPer >= threshold.accounts) ||
      (b.clientsPer !== null && b.clientsPer >= threshold.clients);
    const observation = !counted ? "" : b.accountsPer !== null && b.accountsPer >= threshold.accounts
      ? `${Math.round(b.accountsPer)} accounts per employee (top quartile of Tier ${b.tier})`
      : `${Math.round(b.clientsPer!)} clients per employee (top quartile of Tier ${b.tier})`;
    return [b.companyId, { counted, observation }];
  }));
}

/** Append refreshed checks; keep every other signal, citation and historical check. */
export async function refreshTierHeavyBooks(db: DbLike, sectorId: string, books: TierBook[], classifications: { companyId: string; decision: RiaDecision; reason: string }[]) {
  if (!classifications.length) return 0;
  const decisions = new Map(classifications.map(c => [c.companyId, c]));
  const heavy = tierHeavyBooks(books);
  const latest = await db.selectDistinctOn([companyIcpChecks.companyId]).from(companyIcpChecks)
    .where(and(eq(companyIcpChecks.sectorId, sectorId), inArray(companyIcpChecks.companyId, classifications.map(c => c.companyId))))
    .orderBy(companyIcpChecks.companyId, desc(companyIcpChecks.createdAt), desc(companyIcpChecks.id));
  const updates: (typeof companyIcpChecks.$inferInsert)[] = [];
  for (const check of latest) {
    const signals = check.results.signals as (Omit<BucketResult, "key"> & { key: string })[] | undefined;
    const previous = signals?.find(s => s.key === "heavy_book");
    const current = heavy.get(check.companyId);
    const classification = decisions.get(check.companyId)!;
    const status = classification.decision === "Accept" ? "icp_accepted" : classification.decision === "Hold" ? "icp_watchlist" : "icp_rejected";
    const exclusionReason = classification.decision === "Accept" ? null : classification.reason;
    const heavyChanged = previous && current && (previous.counted !== current.counted || previous.observation !== current.observation);
    if (!heavyChanged && check.status === status && check.exclusionReason === exclusionReason) continue;
    const refreshed = heavyChanged ? signals!.map(s => s.key !== "heavy_book" ? s : { ...s, ...current, verdict: current!.counted ? "yes" : "no" }) : signals;
    updates.push({ ...check, id: randomUUID(), promptVersion: "ria-tiers-v2", createdAt: new Date(),
      packHash: createHash("sha256").update(`${check.packHash}:${JSON.stringify({ current, status, exclusionReason })}`).digest("hex").slice(0, 16),
      score: refreshed ? refreshed.filter(s => s.counted).length : check.score, status, exclusionReason,
      results: { ...check.results, ...(refreshed ? { signals: refreshed } : {}) }, usage: null });
  }
  for (let i = 0; i < updates.length; i += 250) {
    const batch = updates.slice(i, i + 250);
    await db.insert(companyIcpChecks).values(batch);
    await db.execute(sql`UPDATE ${companyVerdicts} v SET score = c.score
      FROM ${companyIcpChecks} c WHERE c.id IN (${sql.join(batch.map(c => sql`${c.id}::uuid`), sql`, `)})
      AND v.company_id = c.company_id AND v.sector_id = c.sector_id`);
  }
  return updates.length;
}
