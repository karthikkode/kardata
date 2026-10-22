import { loadAppEnv } from "../src/lib/env.js";

loadAppEnv();

import { createDb } from "../src/db/client.js";
import { getBatchStatus, getRunDetail } from "../src/domain/research/reads.js";
import { startCollect } from "../src/runs/queue.js";
import { createRunner } from "../src/runs/runner.js";

// Live smoke: collect full research for SMOKE_COMPANY_IDS (comma-separated)
// and assert every area of every company ends with a status.
async function main(): Promise<void> {
  const raw = process.env.SMOKE_COMPANY_IDS ?? "";
  const companyIds = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (companyIds.length === 0) {
    console.error("SMOKE_COMPANY_IDS is not set (comma-separated company UUIDs)");
    process.exit(2);
  }
  const handle = createDb(process.env.DATABASE_URL ?? "");
  try {
    const batch = await startCollect(handle.db, companyIds);
    console.log(`batch ${batch.batchId}: ${batch.runs.length} runs`);
    const runner = createRunner(handle.db);
    await runner.start();
    const terminal = new Set(["succeeded", "partial", "failed", "cancelled", "stalled"]);
    const deadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
      const status = await getBatchStatus(handle.db, batch.batchId);
      const done = status.runs.filter((r) => terminal.has(r.status)).length;
      console.log(`  ${done}/${status.runs.length} terminal (${JSON.stringify(status.counts)})`);
      if (done === status.runs.length) break;
      if (Date.now() > deadline) {
        console.error("timed out waiting for the batch");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    await runner.stop();

    let ok = true;
    const final = await getBatchStatus(handle.db, batch.batchId);
    for (const run of final.runs) {
      const detail = await getRunDetail(handle.db, run.runId);
      const areas = detail.statuses.map((s) => `${s.area}:${s.status}`).join(" ");
      console.log(`${run.companyName} [${run.status}]: ${areas}`);
      if (detail.statuses.length !== 7) {
        console.error(`  MISSING areas for ${run.runId}: only ${detail.statuses.length}/7`);
        ok = false;
      }
    }
    if (!ok) process.exit(1);
    console.log("smoke passed: every area of every company has a status");
  } finally {
    await handle.close();
  }
}

await main();
