import { createDb } from "../src/db/client.js";
import { DomainError } from "../src/domain/errors.js";
import { scorecard, type RunScore } from "../src/domain/research/scorecard.js";
import { loadDotenv, requireEnv } from "../src/lib/env.js";

function usage(): never {
  console.error("usage: npm run eval:research -- [--json] <batchId | runId...>");
  process.exit(2);
}

function fmtShare(share: number | null): string {
  return share === null ? "-" : `${Math.round(share * 100)}%`;
}

function fmtGrounding(v: RunScore["verification"]): string {
  const total = v.verified + v.docOnly + v.unverified;
  if (total === 0) return "-";
  return `${Math.round((v.verified / total) * 100)}% verified (${v.verified}/${v.docOnly}/${v.unverified})`;
}

function fmtTokens(run: RunScore): string {
  if (!run.tokens) return "-";
  const t = run.tokens;
  const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  return `${k(t.input)} in/${k(t.output)} out${t.childrenIncluded ? "" : " (main only)"}`;
}

function printRun(run: RunScore): void {
  console.log(`\n== ${run.companyName ?? run.companyId} [${run.status}] (${run.kind}, ${run.promptVersion ?? "v0"})`);
  console.log(`   run ${run.runId}`);
  console.log(
    `   facts ${run.facts} (primary ${fmtShare(run.primaryShare)}) | ` +
      `records ${Object.entries(run.recordsByType).map(([t, n]) => `${t}:${n}`).join(", ") || "-"} | ` +
      `reviews ${run.reviewsIngested} | docs ${run.documents} | findings ${run.findings} (${run.findingsWellCited} cited 2+)`,
  );
  console.log(
    `   agent: facts ${run.agent.facts} | ` +
      `records ${Object.entries(run.agent.recordsByType).map(([t, n]) => `${t}:${n}`).join(", ") || "-"} | ` +
      `reviews ${run.agent.reviewsIngested} | docs ${run.agent.documents} | findings ${run.agent.findings}`,
  );
  console.log(
    `   extractor: facts ${run.extractor.facts} | ` +
      `records ${Object.entries(run.extractor.recordsByType).map(([t, n]) => `${t}:${n}`).join(", ") || "-"} | ` +
      `reviews ${run.extractor.reviewsIngested} | docs ${run.extractor.documents} | findings ${run.extractor.findings}`,
  );
  console.log(
    `   tokens ${fmtTokens(run)} | minutes ${run.minutes ?? "-"} | mcp ${run.mcpCalls} | forbidden ${run.forbidden} | pii ${run.piiRedactions}`,
  );
  console.log(`   grounding ${fmtGrounding(run.verification)}`);
  if (run.newProvisionalKeys.length > 0) console.log(`   +keys: ${run.newProvisionalKeys.join(", ")}`);
  if (run.newProvisionalTypes.length > 0) console.log(`   +types: ${run.newProvisionalTypes.join(", ")}`);
  const header = "   area          facts  records  reviews  docs  findings  status";
  console.log(header);
  for (const [name, cell] of Object.entries(run.areas)) {
    const records = Object.values(cell.recordsByType).reduce((a, b) => a + b, 0);
    console.log(
      `   ${name.padEnd(13)} ${String(cell.facts).padStart(5)} ${String(records).padStart(7)} ` +
        `${String(cell.reviewsIngested).padStart(7)} ${String(cell.documents).padStart(5)} ` +
        `${String(cell.findings).padStart(8)}  ${cell.status ?? "-"}`,
    );
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const ids = args.filter((a) => a !== "--json");
  if (ids.length === 0) usage();
  const { db, close } = createDb(requireEnv("DATABASE_URL"));
  const fail = (err: unknown): never => {
    if (err instanceof DomainError) {
      console.error(`${err.code}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  };
  try {
    const result =
      ids.length === 1
        ? await scorecard(db, { batchId: ids[0] }).catch((err: unknown) =>
            err instanceof Error && /batch not found/.test(err.message)
              ? scorecard(db, { runIds: ids as string[] })
              : Promise.reject(err),
          )
        : await scorecard(db, { runIds: ids });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    for (const run of result.runs) printRun(run);
    const t = result.totals;
    console.log(
      `\nTotals (${t.runs} runs): facts ${t.facts} | reviews ${t.reviewsIngested} | docs ${t.documents} | ` +
        `findings ${t.findings} | mcp ${t.mcpCalls} | forbidden ${t.forbidden} | minutes ${t.minutes} | ` +
        `tokens ${t.tokens.input} in/${t.tokens.output} out (${t.runsWithUsage} runs with usage) | ` +
        `grounding ${fmtGrounding(t.verification)}`,
    );
  } catch (err) {
    fail(err);
  } finally {
    await close();
  }
}

await main();
