import { loadAppEnv } from "../src/lib/env.js";

loadAppEnv();

import { createDb } from "../src/db/client.js";
import { migrateBulkJob, planBulkMigration } from "../src/runs/migrate.js";

// Bulk → company migration: --dry-run plans only, --execute migrates and
// retires the bulk job. Usage:
//   tsx scripts/migrate-bulk.ts --job <bulkJobId> --dry-run
//   tsx scripts/migrate-bulk.ts --job <bulkJobId> --execute
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jobFlag = args.indexOf("--job");
  const jobId = jobFlag >= 0 ? args[jobFlag + 1] : undefined;
  const execute = args.includes("--execute");
  if (!jobId || (!execute && !args.includes("--dry-run"))) {
    console.error("usage: migrate-bulk.ts --job <bulkJobId> (--dry-run | --execute)");
    process.exit(2);
  }
  const handle = createDb(process.env.DATABASE_URL ?? "");
  try {
    if (!execute) {
      const plan = await planBulkMigration(handle.db, jobId);
      console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
      return;
    }
    const result = await migrateBulkJob(handle.db, jobId);
    console.log(
      JSON.stringify(
        {
          dryRun: false,
          bulkJobId: result.plan.bulkJobId,
          bulkStatus: result.plan.bulkStatus,
          itemCounts: result.plan.itemCounts,
          created: result.created,
          skippedRace: result.skippedRace,
          bulkCancelled: result.bulkCancelled,
        },
        null,
        2,
      ),
    );
  } finally {
    await handle.close();
  }
}

await main();
