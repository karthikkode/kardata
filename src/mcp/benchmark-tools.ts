import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { importBrochureArchive } from "../domain/benchmark/brochure-archive.js";
import { runBenchmarkFees } from "../domain/benchmark/fees.js";
import { ensureEvidenceLibrary } from "../domain/evidence-library.js";
import { importSchedules } from "../domain/sec-adv/schedules.js";
import { importSnapshot } from "../domain/sec-adv/snapshot.js";
import { registerTool, type AuthContext } from "./auth.js";
import { wrap } from "./result.js";

const secUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && ["www.sec.gov", "sec.gov", "adviserinfo.sec.gov"].includes(url.hostname) && !url.username && !url.password;
}, "use the official SEC HTTPS URL");

export function registerBenchmarkTools(server: McpServer, db: Db, auth: AuthContext) {
  registerTool(server, db, auth, "evidence_library_ensure", {
    description: "Create or resolve the internal evidence library and return its sector and company IDs.",
    inputSchema: {},
  }, async () => wrap(async () => ({ summary: "Evidence library ready", data: await ensureEvidenceLibrary(db) })));

  registerTool(server, db, auth, "sec_adv_snapshot_import", {
    description: "Match an allowlisted SEC Form ADV monthly CSV or ZIP to existing sector members. Dry run by default.",
    inputSchema: {
      sectorId: z.string().uuid(), path: z.string().min(1), snapshotDate: z.string(),
      sourceUrl: secUrl, dryRun: z.boolean().optional(), companyIds: z.array(z.string().uuid()).max(200).optional(),
    },
  }, async input => wrap(async () => {
    const data = await importSnapshot(db, input);
    return { summary: `${data.counts.crd + data.counts.secNumber} verified matches, ${data.candidates.length} unverified candidates`, data };
  }));

  registerTool(server, db, auth, "sec_adv_schedules_import", {
    description: "Import archived SEC Form ADV schedules by verified CRD. A snapshotDate selects the historical Part 1 fallback instead. Dry run by default.",
    inputSchema: {
      sectorId: z.string().uuid(), part1Path: z.string(), part2Path: z.string(), part1Url: secUrl, part2Url: secUrl,
      dryRun: z.boolean().optional(), companyIds: z.array(z.string().uuid()).max(200).optional(), snapshotDate: z.string().optional(),
    },
  }, async input => wrap(async () => {
    const data = await importSchedules(db, input);
    return { summary: `${data.matched} matched archive filings, ${data.missing} missing`, data };
  }));

  registerTool(server, db, auth, "benchmark_fees_run", {
    description: "Extract dated, quoted ADV Item 5 fees in a bounded batch. Pilot stops when mean retries exceed one.",
    inputSchema: {
      sectorId: z.string().uuid(), companyIds: z.array(z.string().uuid()).max(200).optional(), afterCompanyId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).optional(), concurrency: z.number().int().min(1).max(16).optional(),
      pilot: z.boolean().optional(),
    },
  }, async input => wrap(async () => {
    const data = await runBenchmarkFees(db, input);
    return { summary: `${data.results.length} fee results${data.stopped ? `, stopped: ${data.stopped}` : ""}`, data };
  }));

  registerTool(server, db, auth, "sec_adv_brochures_import", {
    description: "Read Item 5 from local current Part 2A ZIP entries identified by an official mapping. Dry run by default.",
    inputSchema: {
      sectorId: z.string().uuid(), path: z.string(), sourceUrl: secUrl, mappingUrl: secUrl,
      entries: z.array(z.object({ crd: z.string(), member: z.string(), filedOn: z.string() })).min(1).max(200),
      dryRun: z.boolean().optional(),
    },
  }, async input => wrap(async () => {
    const data = await importBrochureArchive(db, input);
    return { summary: `${data.written}/${data.matched} archived brochures written`, data };
  }));
}
