/**
 * One-off: resolve a sector's classified memberships to the binary owner
 * scope (eligible | ineligible). Overrides always win; pending rows stay
 * pending. Prints counts plus a reason breakdown.
 *
 * Usage: npx tsx scripts/apply-sector-scope.ts <sectorId>
 */
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import { sectorCompanies } from "../src/db/schema.js";
import { applySectorScope } from "../src/domain/sector-preflight/eligibility.js";

async function main(): Promise<void> {
  const sectorId = process.argv[2];
  if (!sectorId) {
    console.error("usage: npx tsx scripts/apply-sector-scope.ts <sectorId>");
    process.exit(2);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  const handle = createDb(dbUrl);
  try {
    const result = await applySectorScope(handle.db, sectorId);
    console.log(JSON.stringify(result));
    const reasons = await handle.db
      .select({ reason: sectorCompanies.eligibilityReason, n: sql<number>`count(*)` })
      .from(sectorCompanies)
      .where(
        and(
          eq(sectorCompanies.sectorId, sectorId),
          sql`${sectorCompanies.eligibilityReason} LIKE 'sector scope:%'`,
        ),
      )
      .groupBy(sectorCompanies.eligibilityReason)
      .orderBy(sql`count(*) DESC`);
    for (const row of reasons) console.log(`${row.n}  ${row.reason}`);
  } finally {
    await handle.close();
  }
}

await main();
