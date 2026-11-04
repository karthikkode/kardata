import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { computeBenchmark } from "../domain/benchmark/compute.js";
import { runWebsiteSoftware } from "../domain/benchmark/website.js";
import { benchmarkReport } from "../domain/benchmark/report.js";
import { importBrochureArchive } from "../domain/benchmark/brochure-archive.js";
import { saveBrochurePageReview } from "../domain/benchmark/brochure-review.js";
import { benchmarkFeeJobStatus, enqueueBenchmarkFeeJob, resumeBenchmarkFeeJob } from "../domain/benchmark/fee-jobs.js";
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
    description: "Queue a background fee review of 20–30 named pilot firms or explicitly opt in to all eligible firms. Returns a job ID immediately.",
    inputSchema: {
      sectorId: z.string().uuid(), companyIds: z.array(z.string().uuid()).min(20).max(30).optional(),
      fullRun: z.literal(true).optional().describe("Explicit opt-in to all active eligible firms, without companyIds or pilot"),
      concurrency: z.number().int().min(1).max(16).optional(), pilot: z.literal(true).optional(),
      requestId: z.string().uuid().optional().describe("Optional idempotency ID for safely retrying the request"),
    },
  }, async input => wrap(async () => {
    const data = await enqueueBenchmarkFeeJob(db, input);
    return { summary: `Fee job ${data.jobId}: ${data.status} (${data.selected} firms)`, data };
  }));

  registerTool(server, db, auth, "benchmark_fees_status", {
    description: "Read a background fee job's current state, completed counts, per-firm telemetry, and eligible-cohort projection.",
    inputSchema: { jobId: z.string().uuid(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ jobId, offset, limit }) => wrap(async () => {
    const data = await benchmarkFeeJobStatus(db, jobId, offset, limit);
    return { summary: `Fee job ${jobId}: ${data.status} (${data.finished}/${data.selected} finished)`, data };
  }));

  registerTool(server, db, auth, "benchmark_fees_resume", {
    description: "Resume pending firms in a fee job paused for provider quota or an operator pause, or interrupted by an execution error.",
    inputSchema: { jobId: z.string().uuid() },
  }, async ({ jobId }) => wrap(async () => {
    const data = await resumeBenchmarkFeeJob(db, jobId);
    return { summary: `Fee job ${jobId}: ${data.status}`, data };
  }));

  registerTool(server, db, auth, "benchmark_brochure_page_review", {
    description: "Save a verbatim transcription after visually reviewing a physical page of the stored original PDF. Use for scanned pages or tables with damaged reading order.",
    inputSchema: {
      companyId: z.string().uuid(), sourceId: z.string().uuid(), page: z.number().int().positive(),
      text: z.string().trim().min(1).max(32_000),
    },
  }, async input => wrap(async () => ({
    summary: "Saved visually reviewed page", data: await saveBrochurePageReview(db, input),
  })));

  registerTool(server, db, auth, "sec_adv_brochures_import", {
    description: "Retain current Part 2A PDFs from local ZIP entries identified by an official mapping. Dry run by default.",
    inputSchema: {
      sectorId: z.string().uuid(), path: z.string(), sourceUrl: secUrl, mappingUrl: secUrl,
      entries: z.array(z.object({ crd: z.string(), member: z.string(), filedOn: z.string() })).min(1).max(200),
      dryRun: z.boolean().optional(),
    },
  }, async input => wrap(async () => {
    const data = await importBrochureArchive(db, input);
    return { summary: `${data.written}/${data.matched} archived brochures written`, data };
  }));

  registerTool(server, db, auth, "benchmark_compute", {
    description: "Calculate company measures and reproducible peer groups from explicit verified snapshot months.",
    inputSchema: {
      sectorId: z.string().uuid(), formulaVersion: z.string().min(1).max(64),
      snapshots: z.object({ current: z.string(), prior1: z.string(), prior2: z.string().optional(), prior3: z.string() }),
    },
  }, async input => wrap(async () => {
    const data = await computeBenchmark(db, input);
    return { summary: `${data.written} firm benchmarks written, revision ${data.revision}`, data };
  }));

  registerTool(server, db, auth, "benchmark_report", {
    description: "Read aggregate field coverage and paged ID-only match exceptions for a benchmark cohort.",
    inputSchema: {
      sectorId: z.string().uuid(), snapshot: z.string().optional(), revision: z.string().optional(),
      offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(500).optional(),
    },
  }, async input => wrap(async () => {
    const data = await benchmarkReport(db, input);
    return { summary: `Coverage for ${data.cohort} active companies`, data };
  }));

  registerTool(server, db, auth, "website_software_collect", {
    description: "Collect software link evidence from a firm's homepage and at most one client page.",
    inputSchema: {
      sectorId: z.string().uuid(), companyIds: z.array(z.string().uuid()).max(100).optional(),
      afterCompanyId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).optional(),
      concurrency: z.number().int().min(1).max(8).optional(),
    },
  }, async input => wrap(async () => {
    const data = await runWebsiteSoftware(db, input);
    return { summary: `${data.results.length} website results`, data };
  }));
}
