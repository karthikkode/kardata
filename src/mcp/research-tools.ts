import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { eq } from "drizzle-orm";
import { sectors } from "../db/schema.js";
import { recordEvent } from "../collect/db.js";
import { fetchUrl } from "../collect/fetch.js";
import { FACT_BATCH_MAX, addFacts } from "../domain/research/facts.js";
import { RECORD_BATCH_MAX, upsertRecords } from "../domain/research/records.js";
import { listRegistry, describeRegistryEntry, curateRegistryEntry } from "../domain/research/registry.js";
import { saveDocument } from "../domain/research/documents.js";
import { addFinding } from "../domain/research/findings.js";
import { setAreaStatus } from "../domain/research/status.js";
import { captureSource } from "../domain/research/sources.js";
import { REVIEWS_BATCH_MAX, reviewsIngest } from "../domain/research/reviews.js";
import { exportCompany } from "../domain/research/export.js";
import { scorecard } from "../domain/research/scorecard.js";
import {
  blobText,
  documentSearch,
  getBatchStatus,
  getCompanyContext,
  getDocument,
  getDocumentHistory,
  getDossier,
  getFacts,
  getRunDetail,
  getSourceExcerpt,
  listDocuments,
  listRecords,
  listRunActivity,
  listRunEvents,
  searchAll,
} from "../domain/research/reads.js";
import { preflightReportSchema, savePreflightReportForRun } from "../domain/company-jobs/preflight.js";
import {
  companyRevenueTruth,
  recordRevenueConfirmation,
  recordVerdicts,
  sectorTierSummary,
} from "../domain/tiering.js";
import { resolveCompanySector, sectorSlug } from "../domain/sectors.js";
import { companyJobLive } from "../domain/company-jobs/live.js";
import {
  estimateInflightBurn,
  quotaBreakerClear,
  quotaBreakerGet,
  quotaCalibrationGet,
  quotaEarlyTripRatioGet,
  quotaEarlyTripRatioSet,
  windowBurn,
} from "../domain/quota/breaker.js";
import { ADAPTERS } from "../collect/adapters.js";
import { riaStatus } from "../domain/ria-steps/status.js";
import { runRiaStep, setRiaStepPaused } from "../domain/ria-steps/runner.js";
import { RIA_STEP_HANDLERS } from "../domain/ria-steps/steps.js";
import { queueRiaDeepResearch } from "../domain/ria-steps/deep-research.js";
import { quotaSnapshotGet } from "../runs/quota-monitor.js";
import { probeMuseVolumeBytes } from "../harness/session-cleanup.js";
import { researchStart } from "../runs/agent.js";
import {
  companyJobCancel,
  companyJobsCancelBulk,
  companyJobList,
  companyJobPause,
  companyJobsPauseAll,
  companyJobResume,
  companyJobRetry,
  companyJobStatus,
  jobsForCompany,
  pipelineStatus,
  startCompanyJob,
  supersedePendingJobs,
} from "../runs/company.js";
import { extractRun } from "../runs/extract.js";
import { cancelRun, getOrCreateManualRun, startCollect } from "../runs/queue.js";
import {
  checkpointSet,
  collectSettingsGet,
  collectSettingsSet,
  companySettingsGet,
  companySettingsSet,
  effectiveMaxAgents,
  extractionSettingsGet,
  extractionSettingsSet,
  harnessSettingsGet,
  harnessSettingsSet,
  sectorPreflightSettingsGet,
  sectorPreflightSettingsSet,
} from "../runs/settings.js";
import {
  startPipeline,
  startSectorIcp,
  startSectorPreflight,
  sectorPreflightCancel,
  sectorPreflightList,
  sectorPreflightPause,
  sectorPreflightResume,
  sectorPreflightRetryFailed,
  sectorPreflightStatus,
  sectorPreflightCompanies,
  sectorPreflightSummary,
} from "../runs/sector.js";
import {
  eligibilityCounts,
  rederiveSectorScope,
  setOverride,
} from "../domain/sector-preflight/eligibility.js";
import {
  getProfileOrNull,
  setProfile,
} from "../domain/sector-preflight/profile.js";
import {
  SCREEN_FIELDS,
  SCREEN_OPS,
  getShortlist,
  listShortlists,
  saveShortlist,
  screenCompanies,
} from "../domain/screening.js";
import { DomainError } from "../domain/errors.js";
import {
  companyContacts,
  importApolloContacts,
  rederiveSectorPublicContacts,
} from "../domain/contacts.js";
import { companyIcpView, sectorIcpCompanies } from "../domain/icp/reads.js";
import { allCheckedCsv, allCheckedRows, outreachCsv, outreachSheetRows, riaCsv, riaSheetRows } from "../domain/icp/sheet.js";
import {
  type AuthContext,
  agentLabelSchema,
  createdByFor,
  registerTool,
  resolveRunId,
  scopedCompany,
} from "./auth.js";
import { companyId, runId, wrap } from "./tools.js";

const areaName = z.string().describe("Research area");
const tags = z.array(z.string()).optional().describe("Tags");
const sourceIds = z.array(z.string()).describe("Source UUIDs (at least one)");

const screenCriterion = z
  .object({
    field: z.string().optional().describe(`Apollo field (one of: ${SCREEN_FIELDS.join(", ")})`),
    factKey: z.string().optional().describe("Current-fact key, e.g. business_model.subscription"),
    qualifiers: z.record(z.string()).optional().describe("Qualifier subset (factKey only)"),
    op: z.enum(SCREEN_OPS).describe("eq ne gt gte lt lte in exists not_exists (a range = gte + lte)"),
    value: z.unknown().optional().describe("Omitted for exists/not_exists"),
  })
  .refine((c) => (c.field === undefined) !== (c.factKey === undefined), {
    message: "exactly one of field or factKey is required",
  });

const screenSort = z
  .object({
    field: z.string().optional().describe("Apollo field to sort by (default: name)"),
    factKey: z.string().optional().describe("Current-fact key to sort by (latest row)"),
    order: z.enum(["asc", "desc"]).optional().describe("Default asc; nulls last, id tiebreaker"),
  })
  .refine((s) => !(s.field !== undefined && s.factKey !== undefined), {
    message: "sort takes exactly one of field or factKey",
  });

function privateHostAllowlist(): string[] {
  const raw = process.env.KARDATA_PRIVATE_HOST_ALLOWLIST ?? "";
  return raw.split(",").map((h) => h.trim()).filter((h) => h !== "");
}

function slugifyTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug !== "" ? slug : "note";
}

export function registerResearchTools(server: McpServer, db: Db, auth: AuthContext): void {
  registerTool(server, db, auth, 
    "collect_start",
    {
      description: "Queue a collect run per company (at most 100). Returns the batch id plus, per company, a run id or already_running.",
      inputSchema: {
        companyIds: z.array(z.string()).describe("Company UUIDs (1..100)"),
        areas: z.array(z.string()).optional().describe("Limit the run to these areas"),
        adapters: z.array(z.string()).optional().describe("Limit the run to these adapters"),
      },
    },
    async ({ companyIds, areas, adapters }) =>
      wrap(async () => {
        const batch = await startCollect(db, companyIds, areas ?? undefined, undefined, adapters ?? undefined);
        const queued = batch.runs.filter((r) => r.status === "queued").length;
        return { summary: `batch ${batch.batchId}: ${queued} queued, ${batch.runs.length - queued} already running`, data: batch };
      }),
  );

  registerTool(server, db, auth,
    "company_screen",
    {
      description: "Screen the live companies of a sector on Apollo fields plus current facts (ANDed criteria). Returns slim rows with matched values and ids[] ready for research_start. For full walks past 500 rows, page with cursor (null starts an id-ordered walk).",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        criteria: z.array(screenCriterion).max(20).optional().describe("ANDed criteria (default: all live companies)"),
        sort: screenSort.optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Default 50"),
        verifiedOnly: z.boolean().optional().describe("Strict: fact criteria match only verified facts (default matches verified + doc_only + verified_value)"),
        includeUnverified: z.boolean().optional().describe("Show unverified and mismatched facts too (default false)"),
        cursor: z.string().uuid().nullable().optional().describe("Keyset cursor: null starts an id-ordered walk, an id continues after it. Cannot combine with sort."),
      },
    },
    async ({ sectorId, criteria, sort, limit, verifiedOnly, includeUnverified, cursor }) =>
      wrap(async () => {
        const result = await screenCompanies(db, sectorId, {
          criteria: criteria ?? undefined,
          sort: sort ?? undefined,
          limit: limit ?? undefined,
          verifiedOnly: verifiedOnly ?? undefined,
          includeUnverified: includeUnverified ?? undefined,
          cursor: cursor === undefined ? undefined : cursor,
        });
        return { summary: `${result.total} companies match`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "shortlist_save",
    {
      description: "Save (insert or replace by sector + name) a named company shortlist.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        name: z.string().describe("Shortlist name"),
        companyIds: z.array(z.string()).max(5000).describe("Company UUIDs (sector members)"),
        criteria: z.array(z.unknown()).optional().describe("The screening criteria, for reference"),
      },
    },
    async ({ sectorId, name, companyIds, criteria }) =>
      wrap(async () => {
        const saved = await saveShortlist(db, {
          sectorId,
          name,
          companyIds,
          criteria: (criteria ?? null) as unknown[] | null,
          createdBy: createdByFor(auth),
        });
        return { summary: `shortlist "${saved.name}": ${saved.companyIds.length} companies`, data: saved };
      }),
  );

  registerTool(server, db, auth,
    "shortlist_get",
    {
      description: "A saved shortlist with its company ids. Returns the shortlist.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        name: z.string().describe("Shortlist name"),
      },
    },
    async ({ sectorId, name }) =>
      wrap(async () => {
        const found = await getShortlist(db, sectorId, name);
        return { summary: `shortlist "${found.name}": ${found.companyIds.length} companies`, data: found };
      }),
  );

  registerTool(server, db, auth,
    "shortlist_list",
    {
      description: "Saved shortlists of a sector. Returns name, size and creation time each.",
      inputSchema: { sectorId: z.string().describe("Sector UUID") },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const lists = await listShortlists(db, sectorId);
        return { summary: `${lists.length} shortlists`, data: { shortlists: lists } };
      }),
  );

  registerTool(server, db, auth, 
    "batch_status",
    {
      description: "Batch counts per status plus one line per run. Returns the batch status.",
      inputSchema: { batchId: z.string().describe("Batch UUID") },
    },
    async ({ batchId }) =>
      wrap(async () => {
        const status = await getBatchStatus(db, batchId);
        return { summary: `batch ${batchId}: ${status.runs.length} runs`, data: status };
      }),
  );

  registerTool(server, db, auth,
    "batch_scorecard",
    {
      description: "Counts per run and per area for a batch, or for a set of company jobs (a pilot): facts, records by type, reviews, documents, findings, primary-source share, grounding verification shares, new registry names, statuses, tokens, minutes, MCP calls, forbidden, and ICP outcomes (status and score counts, Muse tokens per company and per ICP check). Returns the scorecard.",
      inputSchema: {
        batchId: z.string().optional().describe("Batch UUID"),
        companyJobIds: z.array(z.string()).min(1).max(500).optional().describe("Company job UUIDs (instead of batchId)"),
      },
    },
    async ({ batchId, companyJobIds }) =>
      wrap(async () => {
        if ((batchId === undefined) === (companyJobIds === undefined)) {
          throw new DomainError("invalid_input", "pass exactly one of batchId or companyJobIds");
        }
        const result = await scorecard(db, { batchId: batchId ?? undefined, companyJobIds: companyJobIds ?? undefined });
        const label = batchId ? `batch ${batchId}` : `${companyJobIds?.length ?? 0} company jobs`;
        return {
          summary: `${label}: ${result.totals.runs} runs, ${result.totals.facts} facts, ${result.totals.findings} findings, ${result.icp.checked} ICP checks`,
          data: result,
        };
      }),
  );

  registerTool(server, db, auth, 
    "run_get",
    {
      description: "A run with its area statuses and document ids. Returns the run detail.",
      inputSchema: { runId },
    },
    async ({ runId }) =>
      wrap(async () => {
        const detail = await getRunDetail(db, runId);
        return { summary: `run ${runId}: ${detail.run.status}`, data: detail };
      }),
  );

  registerTool(server, db, auth, 
    "run_events",
    {
      description: "Event rows for a run, oldest first. Returns the events.",
      inputSchema: {
        runId,
        afterId: z.number().int().optional().describe("Only events with id above this"),
        limit: z.number().int().optional().describe("1..200, default 200"),
      },
    },
    async ({ runId, afterId, limit }) =>
      wrap(async () => {
        const events = await listRunEvents(db, { runId, afterId: afterId ?? undefined, limit: limit ?? undefined });
        return { summary: `${events.length} events`, data: { events } };
      }),
  );

  registerTool(server, db, auth, 
    "run_cancel",
    {
      description: "Cancel a queued or running run. The run stops before its next fetch. Returns the run.",
      inputSchema: { runId },
    },
    async ({ runId }) =>
      wrap(async () => {
        const run = await cancelRun(db, runId);
        return { summary: `run ${runId}: ${run.status}`, data: { run } };
      }),
  );

  registerTool(server, db, auth, 
    "company_dossier",
    {
      description: "Latest status per area across runs, document titles/ids/sizes per area, finding counts, last run. Returns the dossier.",
      inputSchema: { companyId },
    },
    async ({ companyId }) =>
      wrap(async () => {
        const dossier = await getDossier(db, companyId);
        return { summary: `dossier for "${dossier.company.name}"`, data: dossier };
      }),
  );

  registerTool(server, db, auth, 
    "document_get",
    {
      description: "One content slice plus metadata plus source urls. Returns the document slice.",
      inputSchema: {
        documentId: z.string().describe("Document UUID"),
        offset: z.number().int().optional().describe("Character offset, default 0"),
        maxChars: z.number().int().optional().describe("1..20000, default 20000"),
      },
    },
    async ({ documentId, offset, maxChars }) =>
      wrap(async () => {
        const doc = await getDocument(db, {
          documentId,
          offset: offset ?? undefined,
          maxChars: maxChars ?? undefined,
          companyScope: auth.kind === "run" ? auth.companyId : undefined,
        });
        return { summary: `"${doc.title}" v${doc.version}${doc.truncated ? " (truncated)" : ""}`, data: doc };
      }),
  );

  registerTool(server, db, auth, 
    "document_search",
    {
      description: "Full-text search over current documents. Returns ids, titles, 200-char headlines and ranks.",
      inputSchema: {
        query: z.string().describe("Search text"),
        companyId: companyId.optional(),
        area: areaName.optional(),
        limit: z.number().int().optional().describe("1..50, default 50"),
      },
    },
    async ({ query, companyId, area, limit }) =>
      wrap(async () => {
        const hits = await documentSearch(db, {
          query,
          companyId: companyId ?? undefined,
          area: area ?? undefined,
          limit: limit ?? undefined,
        });
        return { summary: `${hits.length} documents`, data: { hits } };
      }),
  );

  registerTool(server, db, auth, 
    "source_get",
    {
      description: "Source metadata plus an extracted-text excerpt. Returns the source.",
      inputSchema: {
        sourceId: z.string().describe("Source UUID"),
        maxChars: z.number().int().optional().describe("1..5000, default 5000"),
      },
    },
    async ({ sourceId, maxChars }) =>
      wrap(async () => {
        const source = await getSourceExcerpt(db, {
          sourceId,
          maxChars: maxChars ?? undefined,
          companyScope: auth.kind === "run" ? auth.companyId : undefined,
        });
        return { summary: `${source.url} (${source.status})`, data: source };
      }),
  );

  registerTool(server, db, auth, 
    "note_add",
    {
      description: "Save an owner note as an agent_note document. Returns the new document id and path.",
      inputSchema: {
        companyId,
        area: areaName,
        title: z.string().describe("Note title"),
        content: z.string().describe("Markdown content"),
        sourceUrls: z.array(z.string()).optional().describe("URLs the owner looked up by hand"),
      },
    },
    async ({ companyId, area, title, content, sourceUrls }) =>
      wrap(async () => {
        const areaNames = ["reviews", "marketing", "financials", "business_model", "hiring", "product", "decisions"];
        const folder = areaNames.includes(area) ? area : "other";
        const urls = sourceUrls ?? [];
        const body = urls.length > 0 ? `${content}\n\nSources:\n${urls.map((u) => `- ${u}`).join("\n")}` : content;
        const saved = await saveDocument(db, {
          companyId,
          runId: await getOrCreateManualRun(db, companyId),
          path: `${folder}/${slugifyTitle(title)}.md`,
          kind: "agent_note",
          title,
          contentMd: body,
          createdBy: "owner",
        });
        return { summary: `saved note "${title}" (${saved.outcome})`, data: saved };
      }),
  );

  registerTool(server, db, auth, 
    "registry_list",
    {
      description: "Suggestion lists: keys with types/descriptions/qualifiers/use counts, then types with fields. Call first; use straight away. Returns the registry.",
      inputSchema: { area: areaName.optional() },
    },
    async ({ area }) =>
      wrap(async () => {
        const registry = await listRegistry(db, area as never);
        return {
          summary: `${registry.factKeys.length} fact keys, ${registry.recordTypes.length} record types`,
          data: registry,
        };
      }),
  );

  registerTool(server, db, auth, 
    "registry_describe",
    {
      description: "Add a description (and, for types, field details) to an auto-created entry. Returns the entry kind.",
      inputSchema: {
        name: z.string().describe("Fact key or record type name"),
        description: z.string().optional(),
        fields: z
          .array(z.object({ name: z.string(), type: z.string().optional(), description: z.string().optional() }))
          .optional(),
      },
    },
    async ({ name, description, fields }) =>
      wrap(async () => {
        const result = await describeRegistryEntry(db, { name, description: description ?? undefined, fields: fields ?? undefined });
        return { summary: `described ${result.kind} "${name}"`, data: result };
      }),
  );

  registerTool(server, db, auth, 
    "registry_curate",
    {
      description: "Operator tidying: approve a provisional name, rename it, or merge it into another. Returns the result.",
      inputSchema: {
        name: z.string().describe("Fact key or record type name"),
        approve: z.boolean().optional(),
        rename_to: z.string().optional(),
        merge_into: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ name, approve, rename_to, merge_into }) =>
      wrap(async () => {
        const result = await curateRegistryEntry(db, {
          name,
          approve: approve ?? undefined,
          renameTo: rename_to ?? undefined,
          mergeInto: merge_into ?? undefined,
        });
        return { summary: `curated "${name}"`, data: { result } };
      }),
  );

  registerTool(server, db, auth, 
    "source_fetch",
    {
      description: "Fetch a page through the fetcher (robots, delays, budgets enforced) and return the source id plus extracted text, paged. Agents read plain pages this way.",
      inputSchema: {
        companyId,
        url: z.string().describe("http(s) URL to fetch"),
        runId: runId.optional().describe("Defaults to today's manual run for the company"),
        maxChars: z.number().int().optional().describe("1..20000, default 5000"),
        offset: z.number().int().optional().describe("Character offset, default 0"),
      },
    },
    async ({ companyId, url, runId: givenRunId, maxChars, offset }) =>
      wrap(async () => {
        const max = maxChars ?? 5000;
        if (max < 1 || max > 20000) throw new Error("maxChars must be 1..20000");
        const scoped = scopedCompany(auth, companyId);
        const run = await resolveRunId(db, auth, scoped, givenRunId ?? undefined);
        const fetched = await fetchUrl(db, {
          runId: run,
          companyId: scoped,
          collector: "agent",
          url,
          privateHostAllowlist: privateHostAllowlist(),
        });
        let text: string | null = null;
        if (fetched.source.blobSha256) {
          const blob = await blobText(db, fetched.source.blobSha256);
          if (blob) text = blob.text;
        } else if (fetched.text) {
          text = fetched.text;
        }
        const start = offset ?? 0;
        const slice = text === null ? null : text.slice(start, start + max);
        return {
          summary: `${fetched.source.url} (${fetched.source.status})`,
          data: {
            sourceId: fetched.source.id,
            runId: run,
            url: fetched.source.url,
            finalUrl: fetched.source.finalUrl,
            status: fetched.source.status,
            httpStatus: fetched.source.httpStatus,
            error: fetched.source.error,
            text: slice,
            textLength: text?.length ?? 0,
            truncated: text !== null && text.length > start + max,
          },
        };
      }),
  );

  registerTool(server, db, auth, 
    "source_capture",
    {
      description: "Store content seen some other way (via search | browser | muse_fetch) so it has an id and a snapshot. Quote verbatim excerpts, never summaries; browser and muse_fetch must pass the relied-upon passages. Returns the source id.",
      inputSchema: {
        companyId,
        runId: runId.optional().describe("Defaults to today's manual run for the company"),
        url: z.string().describe("http(s) URL the content came from"),
        title: z.string().optional(),
        text: z.string().describe("The content itself (verbatim excerpts)"),
        via: z.enum(["search", "browser", "muse_fetch"]),
        passages: z.array(z.string()).optional().describe("Verbatim relied-upon passages (required for browser | muse_fetch)"),
      },
    },
    async ({ companyId, runId: givenRunId, url, title, text, via, passages }) =>
      wrap(async () => {
        const scoped = scopedCompany(auth, companyId);
        const run = await resolveRunId(db, auth, scoped, givenRunId ?? undefined);
        const captured = await captureSource(db, {
          companyId: scoped,
          runId: run,
          url,
          title: title ?? undefined,
          text,
          via,
          passages: passages ?? undefined,
          createdBy: "owner",
        });
        return {
          summary: `captured ${url} via ${via}${captured.thin ? " (thin)" : ""}`,
          data: { sourceId: captured.sourceId, runId: run, thin: captured.thin, warnings: captured.warnings },
        };
      }),
  );

  registerTool(server, db, auth, 
    "fact_add",
    {
      description: "Write facts (at most 200). Unknown keys and qualifiers are auto-created as provisional, with warnings. Returns per-item ok/error.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
        agentLabel: agentLabelSchema,
        facts: z
          .array(
            z.object({
              key: z.string(),
              value: z.unknown(),
              qualifiers: z.record(z.unknown()).optional(),
              asOf: z.string().nullable().optional(),
              sourceIds,
              confidence: z.string().optional(),
              note: z.string().nullable().optional(),
              tags: z.array(z.string()).optional(),
            }),
          )
          .describe("Facts (at most 200)"),
      },
    },
    async ({ companyId, runId, facts, agentLabel }) =>
      wrap(async () => {
        if (facts.length > FACT_BATCH_MAX) {
          throw new DomainError("invalid_input", `at most ${FACT_BATCH_MAX} facts per call`);
        }
        const scoped = scopedCompany(auth, companyId);
        const run = await resolveRunId(db, auth, scoped, runId ?? undefined);
        const results = await addFacts(db, {
          companyId: scoped,
          runId: run,
          createdBy: createdByFor(auth, agentLabel ?? undefined),
          facts: facts.map((f) => ({
            key: f.key,
            value: f.value,
            qualifiers: f.qualifiers as Record<string, unknown> | undefined,
            asOf: f.asOf ?? null,
            sourceIds: f.sourceIds,
            confidence: f.confidence,
            note: f.note ?? null,
            tags: f.tags,
          })),
        });
        const okCount = results.filter((r) => r.ok).length;
        return { summary: `${okCount}/${results.length} facts written`, data: { results } };
      }),
  );

  registerTool(server, db, auth, 
    "record_upsert",
    {
      description: "Upsert records (at most 500) on natural keys. Unknown types and fields are auto-created, with warnings. Returns per-item created/updated/unchanged/rejected.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
        agentLabel: agentLabelSchema,
        records: z
          .array(
            z.object({
              type: z.string(),
              data: z.record(z.unknown()),
              sourceIds,
              naturalKey: z.array(z.string()).optional(),
              tags: z.array(z.string()).optional(),
            }),
          )
          .describe("Records (at most 500)"),
      },
    },
    async ({ companyId, runId, records, agentLabel }) =>
      wrap(async () => {
        if (records.length > RECORD_BATCH_MAX) {
          throw new DomainError("invalid_input", `at most ${RECORD_BATCH_MAX} records per call`);
        }
        const scoped = scopedCompany(auth, companyId);
        const run = await resolveRunId(db, auth, scoped, runId ?? undefined);
        const results = await upsertRecords(db, {
          companyId: scoped,
          runId: run,
          createdBy: createdByFor(auth, agentLabel ?? undefined),
          records: records.map((r) => ({
            type: r.type,
            data: r.data as Record<string, unknown>,
            sourceIds: r.sourceIds,
            naturalKey: r.naturalKey ?? undefined,
            tags: r.tags,
          })),
        });
        const okCount = results.filter((r) => r.ok).length;
        return { summary: `${okCount}/${results.length} records upserted`, data: { results } };
      }),
  );

  registerTool(server, db, auth, 
    "reviews_ingest",
    {
      description: "Bulk reviews (at most 500): dedupe, identity stripped, 5,000/platform kept, rating facts recomputed. Dateless reviews are stored flagged (date_missing) and counted (reviews.dateless_count). Returns per-item results plus recomputed keys.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
        agentLabel: agentLabelSchema,
        platform: z.string().describe("Review platform"),
        sourceId: z.string().describe("Source the reviews came from"),
        reviews: z
          .array(
            z
              .object({
                text: z.string(),
                rating: z.number().nullable().optional(),
                rating_scale: z.number().nullable().optional(),
                title: z.string().nullable().optional(),
                date: z.string().nullable().optional(),
                product: z.string().nullable().optional(),
                verified_buyer: z.boolean().nullable().optional(),
                url: z.string().nullable().optional(),
                language: z.string().nullable().optional(),
                helpful_count: z.number().nullable().optional(),
                reply_text: z.string().nullable().optional(),
              })
              .passthrough(),
          )
          .describe("Reviews (at most 500)"),
      },
    },
    async ({ companyId, runId, platform, sourceId, reviews, agentLabel }) =>
      wrap(async () => {
        if (reviews.length > REVIEWS_BATCH_MAX) {
          throw new DomainError("invalid_input", `at most ${REVIEWS_BATCH_MAX} reviews per call`);
        }
        const scoped = scopedCompany(auth, companyId);
        const run = await resolveRunId(db, auth, scoped, runId ?? undefined);
        const result = await reviewsIngest(db, {
          companyId: scoped,
          runId: run,
          platform,
          sourceId,
          reviews,
          createdBy: createdByFor(auth, agentLabel ?? undefined),
        });
        const okCount = result.results.filter((r) => r.ok).length;
        return {
          summary: `${okCount}/${result.results.length} reviews ingested${result.trimmed > 0 ? `, ${result.trimmed} trimmed` : ""}`,
          data: result,
        };
      }),
  );

  registerTool(server, db, auth, 
    "document_save",
    {
      description: "Save a versioned markdown document at any lowercase path (area = first folder, else other). Saving identical content is a no-op. Returns id, version and outcome.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
        agentLabel: agentLabelSchema,
        path: z.string().describe("Lowercase [a-z0-9-_/.], ending in .md"),
        kind: z.string().optional().describe("extract, report, agent_note or summary"),
        title: z.string().optional(),
        content: z.string().describe("Markdown content (at most 500 KB)"),
        sourceIds: z.array(z.string()).optional(),
        factIds: z.array(z.string()).optional(),
        recordIds: z.array(z.string()).optional(),
        tags,
      },
    },
    async ({ companyId, runId, path, kind, title, content, sourceIds, factIds, recordIds, tags, agentLabel }) =>
      wrap(async () => {
        const scoped = scopedCompany(auth, companyId);
        const run = await resolveRunId(db, auth, scoped, runId ?? undefined);
        const saved = await saveDocument(db, {
          companyId: scoped,
          runId: run,
          path,
          kind: kind ?? undefined,
          title: title ?? undefined,
          contentMd: content,
          sourceIds: sourceIds ?? undefined,
          factIds: factIds ?? undefined,
          recordIds: recordIds ?? undefined,
          tags: tags ?? undefined,
          createdBy: createdByFor(auth, agentLabel ?? undefined),
        });
        return { summary: `saved ${path} v${saved.version} (${saved.outcome})`, data: saved };
      }),
  );

  registerTool(server, db, auth, 
    "document_list",
    {
      description: "Current documents: the document tree. Returns path, title, kind, area, version, size.",
      inputSchema: {
        companyId,
        prefix: z.string().optional().describe("Only paths starting with this"),
        limit: z.number().int().optional().describe("Default 200"),
      },
    },
    async ({ companyId, prefix, limit }) =>
      wrap(async () => {
        const scoped = scopedCompany(auth, companyId);
        const docs = await listDocuments(db, { companyId: scoped, prefix: prefix ?? undefined, limit: limit ?? undefined });
        return { summary: `${docs.length} documents`, data: { documents: docs } };
      }),
  );

  registerTool(server, db, auth, 
    "document_history",
    {
      description: "Every version of a document, newest first. Returns the versions.",
      inputSchema: { documentId: z.string().describe("Document UUID") },
    },
    async ({ documentId }) =>
      wrap(async () => {
        const versions = await getDocumentHistory(
          db,
          documentId,
          auth.kind === "run" ? auth.companyId : undefined,
        );
        return { summary: `${versions.length} versions`, data: { versions } };
      }),
  );

  registerTool(server, db, auth, 
    "company_export",
    {
      description: "Operator: write current documents, facts and records to real files under var/exports/<slug>/. Returns the directory and counts. Keeps running: files sometimes help.",
      inputSchema: { companyId },
      annotations: { destructiveHint: false },
    },
    async ({ companyId }) =>
      wrap(async () => {
        const result = await exportCompany(db, companyId);
        return { summary: `exported to ${result.dir}`, data: result };
      }),
  );

  registerTool(server, db, auth, 
    "finding_add",
    {
      description: "Add one finding: claim plus supporting sources, optional fact/record links. Needs at least one source. Returns the finding id.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
        agentLabel: agentLabelSchema,
        area: areaName,
        claim: z.string(),
        detail: z.string().nullable().optional(),
        sourceIds,
        factIds: z.array(z.string()).optional(),
        recordIds: z.array(z.string()).optional(),
        confidence: z.string().describe("low, medium or high"),
        status: z.string().describe("supported, contradicted or unverified"),
        tags,
      },
    },
    async ({ companyId, runId, area, claim, detail, sourceIds, factIds, recordIds, confidence, status, tags, agentLabel }) =>
      wrap(async () => {
        const scoped = scopedCompany(auth, companyId);
        const run = await resolveRunId(db, auth, scoped, runId ?? undefined);
        const id = await addFinding(db, {
          companyId: scoped,
          runId: run,
          area,
          claim,
          detail: detail ?? null,
          sourceIds,
          factIds: factIds ?? undefined,
          recordIds: recordIds ?? undefined,
          confidence,
          status,
          tags: tags ?? undefined,
          createdBy: createdByFor(auth, agentLabel ?? undefined),
        });
        return { summary: `added finding ${id}`, data: { id } };
      }),
  );

  registerTool(server, db, auth, 
    "area_status_set",
    {
      description: "Record an area status. Non-done statuses need a reason. Returns the status.",
      inputSchema: {
        runId: runId.optional().describe("Defaults to the caller's run"),
        area: areaName,
        status: z.string().describe("done, not_found, blocked, error or skipped"),
        reason: z.string().nullable().optional(),
      },
    },
    async ({ runId: givenRunId, area, status, reason }) =>
      wrap(async () => {
        const run =
          auth.kind === "run"
            ? await resolveRunId(db, auth, auth.companyId, givenRunId ?? undefined)
            : givenRunId;
        if (!run) throw new DomainError("invalid_input", "runId is required");
        await setAreaStatus(db, { runId: run, area, status, reason: reason ?? null });
        return { summary: `${area}: ${status}`, data: { runId: run, area, status } };
      }),
  );

  registerTool(server, db, auth, 
    "company_context",
    {
      description: "Everything known about a company: current grounded facts, record counts per type, the document tree, findings, area statuses. Returns the context.",
      inputSchema: {
        companyId,
        includeUnverified: z.boolean().optional().describe("Show unverified and mismatched facts, records and findings too (default false)"),
      },
    },
    async ({ companyId, includeUnverified }) =>
      wrap(async () => {
        const context = await getCompanyContext(db, scopedCompany(auth, companyId), {
          includeUnverified: includeUnverified ?? undefined,
        });
        return { summary: `context for "${context.company.name}"`, data: context };
      }),
  );

  registerTool(server, db, auth, 
    "facts_get",
    {
      description: "Current facts (or full history) for a company, optionally filtered to keys. Returns the facts.",
      inputSchema: {
        companyId,
        keys: z.array(z.string()).optional(),
        history: z.boolean().optional().describe("Full history instead of current"),
        limit: z.number().int().optional().describe("Default 200"),
      },
    },
    async ({ companyId, keys, history, limit }) =>
      wrap(async () => {
        const facts = await getFacts(db, {
          companyId: scopedCompany(auth, companyId),
          keys: keys ?? undefined,
          history: history ?? undefined,
          limit: limit ?? undefined,
        });
        return { summary: `${facts.length} facts`, data: { facts } };
      }),
  );

  registerTool(server, db, auth, 
    "records_list",
    {
      description: "Records of one type, optionally full-text filtered. Returns the records.",
      inputSchema: {
        companyId,
        type: z.string().describe("Record type name"),
        query: z.string().optional().describe("Full-text filter"),
        limit: z.number().int().optional().describe("Default 50"),
      },
    },
    async ({ companyId, type, query, limit }) =>
      wrap(async () => {
        const records = await listRecords(db, {
          companyId: scopedCompany(auth, companyId),
          type,
          query: query ?? undefined,
          limit: limit ?? undefined,
        });
        return { summary: `${records.length} ${type} records`, data: { records } };
      }),
  );

  registerTool(server, db, auth, 
    "search",
    {
      description: "Full-text search across documents, records, facts and sources, ranked. Returns the hits.",
      inputSchema: {
        query: z.string().describe("Search text"),
        companyId: companyId.optional(),
        kinds: z.array(z.enum(["document", "record", "fact", "source"])).optional(),
        area: areaName.optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().optional().describe("Default 20"),
      },
    },
    async ({ query, companyId, kinds, area, tags, limit }) =>
      wrap(async () => {
        const hits = await searchAll(db, {
          query,
          companyId: scopedCompany(auth, companyId ?? undefined) ?? undefined,
          kinds: kinds ?? undefined,
          area: area ?? undefined,
          tags: tags ?? undefined,
          limit: limit ?? undefined,
        });
        return { summary: `${hits.length} hits`, data: { hits } };
      }),
  );

  registerTool(server, db, auth,
    "research_start",
    {
      description: "Start one research agent run per company (at most 100). Returns the batch id plus, per company, a run id or already_running.",
      inputSchema: {
        companyIds: z.array(z.string()).describe("Company UUIDs (1..100)"),
        areas: z.array(z.string()).optional().describe("Limit the run to these areas"),
        recollectIfOlderThanDays: z.number().optional().describe("Recollect when no fresh collect exists (default 14)"),
        maxMinutes: z.number().optional().describe("Agent wall-time limit (default 40)"),
        maxModelSteps: z.number().int().optional().describe("Model step cap (default 100)"),
        brief: z.string().optional().describe("Extra owner instructions (at most 2 KB)"),
        promptVersion: z.string().optional().describe("Prompt version (default: latest)"),
        sectorId: z.string().optional().describe("Sector UUID (each company must be in it; resolved per company when omitted)"),
      },
    },
    async ({ companyIds, areas, recollectIfOlderThanDays, maxMinutes, maxModelSteps, brief, promptVersion, sectorId }) =>
      wrap(async () => {
        const batch = await researchStart(db, {
          sectorId: sectorId ?? undefined,
          companyIds,
          areas: areas ?? undefined,
          recollectIfOlderThanDays: recollectIfOlderThanDays ?? undefined,
          maxMinutes: maxMinutes ?? undefined,
          maxModelSteps: maxModelSteps ?? undefined,
          brief: brief ?? undefined,
          promptVersion: promptVersion ?? undefined,
        });
        const queued = batch.runs.filter((r) => r.status === "queued").length;
        return { summary: `batch ${batch.batchId}: ${queued} queued, ${batch.runs.length - queued} already running`, data: batch };
      }),
  );

  registerTool(server, db, auth,
    "run_activity",
    {
      description: "Harness events plus the mcp_call audit trail for a run, oldest first. Returns the events.",
      inputSchema: {
        runId,
        afterId: z.number().int().optional().describe("Only events with id above this"),
        limit: z.number().int().optional().describe("1..200, default 200"),
      },
    },
    async ({ runId, afterId, limit }) =>
      wrap(async () => {
        const events = await listRunActivity(db, { runId, afterId: afterId ?? undefined, limit: limit ?? undefined });
        return { summary: `${events.length} events`, data: { events } };
      }),
  );

  registerTool(server, db, auth,
    "extract_run",
    {
      description: "Re-extract structured facts, records and findings from an agent run's cited notes, one headless extractor call per area plus synthesis (operator only). Returns per-area counts and merged usage.",
      inputSchema: {
        runId,
      },
    },
    async ({ runId }) =>
      wrap(async () => {
        const result = await extractRun(db, runId);
        const done = result.areas.filter((a) => a.error === null).length;
        const facts = result.areas.reduce((n, a) => n + a.writtenFacts, 0);
        return {
          summary: `extracted ${done}/${result.areas.length} areas from run ${runId} (${facts} facts)`,
          data: result,
        };
      }),
  );

  registerTool(server, db, auth,
    "run_finish",
    {
      description: "Agent's explicit end: record the final summary and mark the agent phase complete. Returns the run id.",
      inputSchema: {
        runId: runId.optional().describe("Defaults to the caller's run"),
        summary: z.string().max(8000).describe("Final summary"),
        areaOutcomes: z
          .array(
            z.object({
              area: z.string(),
              status: z.string(),
              reason: z.string().nullable().optional(),
            }),
          )
          .max(100)
          .optional()
          .describe("Per-area outcomes"),
      },
    },
    async ({ runId: givenRunId, summary, areaOutcomes }) =>
      wrap(async () => {
        const run =
          auth.kind === "run"
            ? await resolveRunId(db, auth, auth.companyId, givenRunId ?? undefined)
            : givenRunId;
        if (!run) throw new DomainError("invalid_input", "runId is required");
        await recordEvent(db, run, "agent_finish", {
          summary,
          areaOutcomes: areaOutcomes ?? [],
        });
        return { summary: `run ${run} finished`, data: { runId: run } };
      }),
  );

  registerTool(server, db, auth,
    "preflight_report_save",
    {
      description: "Agent: file the collect plan for a company-job preflight run (PreflightReportV1 JSON). Re-validated on every save; the latest version gates the collect stage.",
      inputSchema: {
        runId: runId.optional().describe("Defaults to the caller's run"),
        report: preflightReportSchema.describe("PreflightReportV1 as a JSON object"),
      },
    },
    async ({ runId: givenRunId, report }) =>
      wrap(async () => {
        const id =
          auth.kind === "run"
            ? await resolveRunId(db, auth, auth.companyId, givenRunId ?? undefined)
            : givenRunId;
        if (!id) throw new DomainError("invalid_input", "runId is required");
        const saved = await savePreflightReportForRun(db, id, report);
        return {
          summary: `preflight report v${saved.reportVersion} saved for job ${saved.jobId}`,
          data: { jobId: saved.jobId, reportVersion: saved.reportVersion },
        };
      }),
  );

  const jobId = z.string().describe("Job UUID");
  const jobBudget = z.object({
    maxTokens: z.number().int().optional(),
    maxHours: z.number().optional(),
  }).optional().describe("Pause the job when a budget is reached");

  registerTool(server, db, auth,
    "harness_settings_get",
    {
      description: "Operator: effective harness settings (agent concurrency) and where each value comes from.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const settings = await harnessSettingsGet(db);
        const earlyTrip = await quotaEarlyTripRatioGet(db);
        const volumeUsedBytes = probeMuseVolumeBytes();
        return {
          summary: `maxConcurrentAgents=${settings.maxConcurrentAgents} (${settings.source}); quotaEarlyTripRatio=${earlyTrip.ratio} (${earlyTrip.source}); kardata_muse volume ${volumeUsedBytes === null ? "size unknown" : `${(volumeUsedBytes / 1_000_000).toFixed(1)} MB used`}`,
          data: { ...settings, quotaEarlyTripRatio: earlyTrip.ratio, quotaEarlyTripSource: earlyTrip.source, museVolumeUsedBytes: volumeUsedBytes },
        };
      }),
  );

  registerTool(server, db, auth,
    "harness_settings_set",
    {
      description: "Operator: change agent concurrency (1..64) and/or the quota early-trip ratio (default 0.90) at runtime, stored in the DB, immediate.",
      inputSchema: {
        maxConcurrentAgents: z.number().int().optional().describe("Max parallel agent runs"),
        quotaEarlyTripRatio: z.number().optional().describe("Early-trip ratio between 0 and 1 (default 0.90)"),
      },
    },
    async ({ maxConcurrentAgents, quotaEarlyTripRatio }) =>
      wrap(async () => {
        let settings = await harnessSettingsGet(db);
        if (maxConcurrentAgents !== undefined) settings = await harnessSettingsSet(db, maxConcurrentAgents);
        let earlyTrip = await quotaEarlyTripRatioGet(db);
        if (quotaEarlyTripRatio !== undefined) {
          try {
            earlyTrip = await quotaEarlyTripRatioSet(db, quotaEarlyTripRatio);
          } catch (err) {
            throw new DomainError("invalid_input", err instanceof Error ? err.message : "bad ratio");
          }
        }
        return {
          summary: `maxConcurrentAgents=${settings.maxConcurrentAgents}; quotaEarlyTripRatio=${earlyTrip.ratio} (${earlyTrip.source})`,
          data: { ...settings, quotaEarlyTripRatio: earlyTrip.ratio, quotaEarlyTripSource: earlyTrip.source },
        };
      }),
  );

  registerTool(server, db, auth,
    "company_job_start",
    {
      description: "Operator: run the full pipeline (preflight, collect, research, extraction) for one company. One active job per company.",
      inputSchema: {
        companyId,
        sectorId: z.string().optional().describe("Sector UUID (resolved from the company's only sector when omitted)"),
        budget: jobBudget,
      },
    },
    async ({ companyId: id, sectorId, budget }) =>
      wrap(async () => {
        const result = await startCompanyJob(db, { companyId: id, sectorId: sectorId ?? undefined, budget: budget ?? undefined });
        return { summary: `company job ${result.jobId} started`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "company_job_status",
    {
      description: "Operator: company job stage states, derived completion, active subjob, tokens, ETA and recent events.",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        const view = await companyJobStatus(db, id);
        return { summary: `job ${id}: ${view.job.status}, ${view.derived}`, data: view };
      }),
  );

  registerTool(server, db, auth,
    "adapter_list",
    {
      description: "Operator: the onboarded source adapters (id, version, areas). Collect runs only these; anything else pauses for onboarding.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const adapters = ADAPTERS.map((a) => ({ id: a.id, version: a.version, areas: a.areas, blurb: a.blurb }));
        return { summary: `${adapters.length} adapters`, data: { adapters } };
      }),
  );

  registerTool(server, db, auth,
    "company_job_live",
    {
      description: "Operator: live view of a job — the active run's stage, areas, recent tool calls, tokens, stall countdown. Null active when idle.",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        const live = await companyJobLive(db, id);
        return {
          summary: live.active ? `job ${id}: ${live.active.stage} live (${live.active.recentCalls.length} recent calls)` : `job ${id} idle`,
          data: live,
        };
      }),
  );

  registerTool(server, db, auth,
    "company_jobs_list",
    {
      description: "Operator: recent company jobs with derived completion.",
      inputSchema: {
        limit: z.number().int().optional().describe("Default 20, max 100"),
        status: z.enum(["created", "scheduled", "running", "paused", "completed", "failed", "terminated"]).optional().describe("Only jobs in this status"),
      },
    },
    async ({ limit, status }) =>
      wrap(async () => {
        const jobs = await companyJobList(db, limit ?? undefined, status ?? undefined);
        return { summary: `${jobs.length} company jobs`, data: { jobs } };
      }),
  );

  registerTool(server, db, auth,
    "jobs_for_company",
    {
      description: "Operator: all company jobs and research runs for one company (stage, status, dates).",
      inputSchema: {
        companyId: z.string().optional().describe("Company id"),
        domain: z.string().optional().describe("Company domain (bare or full URL); exactly one of companyId or domain"),
      },
    },
    async ({ companyId, domain }) =>
      wrap(async () => {
        const view = await jobsForCompany(db, { companyId: companyId ?? undefined, domain: domain ?? undefined });
        return {
          summary: `${view.jobs.length} jobs, ${view.runs.length} runs for "${view.company.name}"`,
          data: view,
        };
      }),
  );

  registerTool(server, db, auth,
    "company_revenue_truth",
    {
      description:
        "Operator (read-only): D-55 revenue truth for one company: revenue used, its source, any rejected figure and why, staff and its source, tier, score, layer, ICP status (icp_accepted, icp_watchlist, icp_rejected), and flags.",
      inputSchema: {
        companyId: z.string().describe("Company UUID"),
        sectorId: z.string().optional().describe("Sector UUID (resolved from the company's only sector when omitted)"),
      },
    },
    async ({ companyId, sectorId }) =>
      wrap(async () => {
        const truth = await companyRevenueTruth(db, companyId, await resolveCompanySector(db, companyId, sectorId));
        return {
          summary: `tier ${truth.tier ?? "-"} layer ${truth.layer ?? "-"} (${truth.status})`,
          data: truth,
        };
      }),
  );

  registerTool(server, db, auth,
    "sector_tier_summary",
    {
      description:
        "Operator (read-only): sector counts by tier x layer (ICP accepted), by revenue source and by ICP status, computed from stored facts and verdicts (D-55); plus contact statuses and how many companies are contactable (an Apollo-verified email, D-67).",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
      },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const summary = await sectorTierSummary(db, sectorId);
        return {
          summary: `${summary.companiesWithVerdicts} companies with verdicts`,
          data: summary,
        };
      }),
  );

  registerTool(server, db, auth,
    "company_verdict_record",
    {
      description:
        "Operator: record ICP verdicts by hand (signal score, signals, ICP status) for up to 200 companies. The ICP check (sector_icp_start) writes verdicts itself; a verdict whose source starts with \"override:\" is the owner's call and is never overwritten by a check.",
      inputSchema: {
        verdicts: z
          .array(
            z.object({
              companyId: z.string(),
              sectorId: z.string(),
              score: z.number().int().min(0).max(6),
              signals: z.record(z.string(), z.boolean()).default({}),
              status: z.enum(["icp_accepted", "icp_watchlist", "icp_rejected", "research_incomplete"]),
              exclusionReason: z.string().nullable().optional(),
              source: z.string().min(1),
            }),
          )
          .min(1)
          .max(200),
      },
    },
    async ({ verdicts }) =>
      wrap(async () => {
        const result = await recordVerdicts(db, verdicts);
        return { summary: `${result.recorded} verdict(s) recorded`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "company_revenue_confirm",
    {
      description:
        "Operator: confirm or reject a flagged public revenue figure (over $1M per staff) for one company, with a reason. Only a confirmed figure may set the tier; a rejected figure stays visible and the next source down is used.",
      inputSchema: {
        companyId: z.string().describe("Company UUID"),
        decision: z.enum(["confirm", "reject"]).describe("confirm = the brand's own figure; reject = parent/group or wrong"),
        reason: z.string().min(1).describe("Why, in plain words"),
      },
    },
    async ({ companyId, decision, reason }) =>
      wrap(async () => {
        const result = await recordRevenueConfirmation(db, { companyId, decision, reason });
        return { summary: `${decision}: ${reason}`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "company_sheet_export",
    {
      description:
        "Operator: write var/sectors/<sector-slug>/analysis/companies-<date>.csv for manual outreach tracking: ICP accepted companies only (D-55 tiers), one block per tier, by layer then score, with company id, signals met, the ICP check's observations (date, URL), tech team flag, buyer order by staff size (roles only), and blank tracking columns. includeAll also writes companies-<date>-all.csv: every checked company with its status and why.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        includeAll: z.boolean().optional().describe("Also write every checked company with status and exclusion reason"),
      },
    },
    async ({ sectorId, includeAll }) =>
      wrap(async () => {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const sectorProfile = await getProfileOrNull(db, sectorId);
        const isRia = sectorProfile?.playbook === "ria";
        const riaRows = isRia ? await riaSheetRows(db, sectorId) : null;
        const rows = isRia ? [] : await outreachSheetRows(db, sectorId);
        const date = new Date().toISOString().slice(0, 10);
        const [sectorRow] = await db.select({ name: sectors.name }).from(sectors).where(eq(sectors.id, sectorId));
        const dir = join(process.cwd(), "var", "sectors", sectorSlug(sectorRow?.name ?? "sector"), "analysis");
        await mkdir(dir, { recursive: true });
        const path = join(dir, `companies-${date}.csv`);
        await writeFile(path, isRia && riaRows ? riaCsv(riaRows) : outreachCsv(rows), "utf8");
        let allPath: string | null = null;
        let allRows = 0;
        if (includeAll) {
          const all = await allCheckedRows(db, sectorId);
          allPath = join(dir, `companies-${date}-all.csv`);
          await writeFile(allPath, allCheckedCsv(all), "utf8");
          allRows = all.length;
        }
        const sheetCount = isRia && riaRows ? riaRows.length : rows.length;
        return {
          summary: `${sheetCount} ICP accepted companies written to ${path}${allPath ? `; ${allRows} checked companies to ${allPath}` : ""}`,
          data: { path, rows: sheetCount, allPath, allRows },
        };
      }),
  );

  registerTool(server, db, auth,
    "company_job_pause",
    {
      description: "Operator: pause a company job (stops the live run; resume restarts the stage with saved work).",
      inputSchema: { jobId, reason: z.string().optional().describe("Why (stored with the pause)") },
    },
    async ({ jobId: id, reason }) =>
      wrap(async () => {
        await companyJobPause(db, id, reason ?? undefined);
        return { summary: `job ${id} paused`, data: { jobId: id } };
      }),
  );

  registerTool(server, db, auth,
    "company_jobs_pause_all",
    {
      description: "Operator: pause every scheduled/running company job (stops their live runs). Resume each job when ready.",
      inputSchema: { reason: z.string().describe("Why (stored with each pause)") },
    },
    async ({ reason }) =>
      wrap(async () => {
        const result = await companyJobsPauseAll(db, reason);
        return { summary: `${result.paused.length} jobs paused`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "company_job_resume",
    {
      description: "Operator: resume a paused company job (retries the failed stage if there is one).",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        await companyJobResume(db, id);
        return { summary: `job ${id} resumed`, data: { jobId: id } };
      }),
  );

  registerTool(server, db, auth,
    "company_job_cancel",
    {
      description: "Operator: cancel a company job. The active subjob is cancelled unless stopRunning is false.",
      inputSchema: { jobId, stopRunning: z.boolean().optional().describe("Cancel the active subjob too (default true)") },
    },
    async ({ jobId: id, stopRunning }) =>
      wrap(async () => {
        await companyJobCancel(db, id, { stopRunning: stopRunning ?? undefined });
        return { summary: `job ${id} cancelled`, data: { jobId: id } };
      }),
  );

  registerTool(server, db, auth,
    "company_jobs_cancel",
    {
      description: "Operator: bulk-cancel company jobs in a sector by status (e.g. paused, failed), with their active subjobs stopped.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        statuses: z.array(z.string()).min(1).describe("Job statuses to cancel"),
        reason: z.string().optional().describe("Recorded in the summary only"),
      },
    },
    async ({ sectorId, statuses }) =>
      wrap(async () => {
        const result = await companyJobsCancelBulk(db, { sectorId, statuses });
        return { summary: `${result.cancelled} jobs cancelled`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "ria_status",
    {
      description: "Operator: RIA step coverage over eligible firms. Optional companyIds scopes coverage and returns each stored step status, reason, tokens and update time. Import and preflight counts remain sector-wide.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        companyIds: z.array(z.string().uuid()).max(5000).optional().describe("Scope coverage and return step details for these eligible firms"),
      },
    },
    async ({ sectorId, companyIds }) =>
      wrap(async () => {
        const view = await riaStatus(db, sectorId, companyIds);
        const parts = Object.entries(view.steps).map(([k, v]) => `${k} ${v.done}/${v.gap}/${v.failed}/${v.pending}`).join("; ");
        return { summary: `eligible ${view.eligible}: ${parts}`, data: view };
      }),
  );

  registerTool(server, db, auth,
    "ria_step_run",
    {
      description: "Operator: run one RIA pipeline step (firm_data, brochure, ops_read, contacts, signals) over eligible firms or a list. Skips firms already done; honours pause and the 90% quota stop for AI steps.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        step: z.enum(["firm_data", "brochure", "ops_read", "contacts", "signals"]).describe("Step name"),
        companyIds: z.array(z.string()).optional().describe("Exactly these firms (re-runs even when done)"),
        limit: z.number().int().optional().describe("Cap firms in this call"),
        concurrency: z.number().int().optional().describe("Parallel firms (default 4, max 16; SEC host delay still applies)"),
      },
    },
    async ({ sectorId, step, companyIds, limit, concurrency }) =>
      wrap(async () => {
        const result = await runRiaStep(db, { sectorId, step: step as never, companyIds: companyIds ?? undefined, limit: limit ?? undefined, concurrency: concurrency ?? undefined }, RIA_STEP_HANDLERS);
        return { summary: `${step}: done ${result.done}, gap ${result.gap}, failed ${result.failed}, skipped ${result.skippedDone}${result.stopped ? `, stopped (${result.stopped})` : ""}, tokens ${result.tokensUsed}`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "ria_step_pause",
    {
      description: "Operator: pause or resume RIA step runs.",
      inputSchema: { paused: z.boolean().describe("true pauses, false resumes") },
    },
    async ({ paused }) =>
      wrap(async () => {
        await setRiaStepPaused(db, paused);
        return { summary: `ria steps ${paused ? "paused" : "resumed"}`, data: { paused } };
      }),
  );

  registerTool(server, db, auth,
    "ria_deep_research",
    {
      description: "Operator: queue deep research for a NAMED list of eligible RIA firms only (opt-in; the light steps are the default). The run reads stored step data first and researches only deals, ops job posts and recent news.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        companyIds: z.array(z.string()).min(1).describe("Named firms to research (max 50)"),
      },
    },
    async ({ sectorId, companyIds }) =>
      wrap(async () => {
        const result = await queueRiaDeepResearch(db, { sectorId, companyIds: companyIds ?? [] });
        return { summary: `deep research queued ${result.queued.length}, rejected ${result.rejected.length}`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "company_job_retry",
    {
      description: "Operator: retry the failed stage of a failed (or paused-with-failure) company job.",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        const result = await companyJobRetry(db, id);
        return { summary: `job ${id} retrying ${result.stage}`, data: { jobId: id, stage: result.stage } };
      }),
  );

  registerTool(server, db, auth,
    "company_jobs_supersede",
    {
      description: "Operator: terminate every created company job with a reason (e.g. a new pass supersedes the batch).",
      inputSchema: { reason: z.string().describe("Why the created jobs are terminated") },
    },
    async ({ reason }) =>
      wrap(async () => {
        const result = await supersedePendingJobs(db, reason);
        return { summary: `${result.terminated} created jobs terminated`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "company_concurrency_get",
    {
      description: "Operator: effective company concurrency and where the value comes from.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const settings = await companySettingsGet(db);
        return { summary: `companyConcurrency=${settings.companyConcurrency} (${settings.source})`, data: settings };
      }),
  );

  registerTool(server, db, auth,
    "company_concurrency_set",
    {
      description: "Operator: change company concurrency at runtime (1..100, stored in the DB, immediate).",
      inputSchema: { companyConcurrency: z.number().int().describe("Max parallel company jobs") },
    },
    async ({ companyConcurrency: value }) =>
      wrap(async () => {
        const settings = await companySettingsSet(db, value);
        return { summary: `companyConcurrency -> ${settings.companyConcurrency}`, data: settings };
      }),
  );

  registerTool(server, db, auth,
    "collect_concurrency_get",
    {
      description: "Operator: effective collect concurrency and where the value comes from.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const settings = await collectSettingsGet(db);
        return { summary: `collectConcurrency=${settings.collectConcurrency} (${settings.source})`, data: settings };
      }),
  );

  registerTool(server, db, auth,
    "collect_concurrency_set",
    {
      description: "Operator: change collect concurrency at runtime (1..64, stored in the DB, immediate).",
      inputSchema: { collectConcurrency: z.number().int().describe("Max parallel deterministic collects") },
    },
    async ({ collectConcurrency: value }) =>
      wrap(async () => {
        const settings = await collectSettingsSet(db, value);
        return { summary: `collectConcurrency -> ${settings.collectConcurrency}`, data: settings };
      }),
  );

  registerTool(server, db, auth,
    "extraction_concurrency_get",
    {
      description: "Operator: effective extraction pool width and where the value comes from.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const settings = await extractionSettingsGet(db);
        return { summary: `extractionConcurrency=${settings.extractionConcurrency} (${settings.source})`, data: settings };
      }),
  );

  registerTool(server, db, auth,
    "extraction_concurrency_set",
    {
      description: "Operator: change extraction pool width at runtime (1..64, stored in the DB, immediate).",
      inputSchema: { extractionConcurrency: z.number().int().describe("Max parallel extractions") },
    },
    async ({ extractionConcurrency: value }) =>
      wrap(async () => {
        const settings = await extractionSettingsSet(db, value);
        return { summary: `extractionConcurrency -> ${settings.extractionConcurrency}`, data: settings };
      }),
  );

  registerTool(server, db, auth,
    "pipeline_status",
    {
      description: "Operator: batch overview — job counts, checkpoint target, pause state, quota snapshot.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const status = await pipelineStatus(db);
        const pause = status.paused.paused ? "paused" : "flowing";
        return {
          summary: `${status.completed} completed, ${pause} (checkpoint ${status.checkpointTarget ?? "off"})`,
          data: status,
        };
      }),
  );

  registerTool(server, db, auth,
    "pipeline_checkpoint_set",
    {
      description:
        "Operator: pause promotion after N completions (in-flight jobs finish). Null clears. Setting a target resumes.",
      inputSchema: { afterCompleted: z.number().int().nullable().describe("Completion count that pauses the batch, or null") },
    },
    async ({ afterCompleted: target }) =>
      wrap(async () => {
        const checkpoint = await checkpointSet(db, target);
        return {
          summary: checkpoint.target === null ? "checkpoint cleared" : `checkpoint -> ${checkpoint.target}`,
          data: checkpoint,
        };
      }),
  );

  registerTool(server, db, auth,
    "quota_breaker_status",
    {
      description: "Operator: quota breaker state — trip, reset time, live 5h/weekly % from the monitor, burn vs learned allowance.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const trip = await quotaBreakerGet(db);
        const cal = await quotaCalibrationGet(db);
        const start = cal ? new Date(cal.windowStart) : null;
        const burn = await windowBurn(db, start && !Number.isNaN(start.getTime()) ? start : null);
        const inflight = await estimateInflightBurn(db);
        const total = burn + inflight;
        const pct =
          cal && cal.allowanceEstimate > 0 ? Math.round((total / cal.allowanceEstimate) * 100) : null;
        const agentsMax = (await harnessSettingsGet(db)).maxConcurrentAgents;
        const agentsAllowed = await effectiveMaxAgents(db);
        const live = await quotaSnapshotGet(db);
        const liveText =
          live === null
            ? null
            : `live 5h ${live.fivePct ?? "?"}% / weekly ${live.weeklyPct ?? "?"}% (checked ${live.checkedAt})`;
        return {
          summary: trip.tripped
            ? `breaker tripped, resumes ${trip.resumeAt ?? "on owner go"}`
            : liveText ?? (pct === null
              ? `no trip, burn ${burn} (uncalibrated)`
              : `no trip, burn ${total} (${pct}% of learned window)`),
          data: { trip, calibration: cal, burn, inflight, pct, agentsAllowed, agentsMax, live },
        };
      }),
  );

  registerTool(server, db, auth,
    "quota_breaker_clear",
    {
      description: "Operator: clear a quota trip hold (jobs stay paused; resume each when ready).",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        await quotaBreakerClear(db);
        return { summary: "breaker cleared", data: { tripped: false } };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_start",
    {
      description: "Operator: classify every company in a sector (eligibility pass) as a DB-backed job.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        onlyPending: z.boolean().optional().describe("Skip already-classified companies (default true)"),
        maxCompanies: z.number().int().optional().describe("Cap the job at this many companies"),
        companyIds: z.array(z.string()).optional().describe("Classify exactly these companies (default: all members)"),
        onlyLowConfidence: z
          .boolean()
          .optional()
          .describe("Re-classify only low-confidence companies (unreadable or thin sites); implies onlyPending false"),
        eligibility: z
          .array(z.enum(["eligible", "review", "ineligible"]))
          .optional()
          .describe("Re-classify only companies with this eligibility (review pass: [\"review\"]); implies onlyPending false"),
        forceWeb: z
          .boolean()
          .optional()
          .describe("Muse reads every site itself with its web tools, even when our fetch worked (review pass)"),
        budget: jobBudget,
      },
    },
    async ({ sectorId, onlyPending, maxCompanies, companyIds, onlyLowConfidence, eligibility, forceWeb, budget }) =>
      wrap(async () => {
        const result = await startSectorPreflight(db, {
          sectorId,
          onlyPending: onlyPending ?? undefined,
          maxCompanies: maxCompanies ?? undefined,
          companyIds: companyIds ?? undefined,
          onlyLowConfidence: onlyLowConfidence ?? undefined,
          eligibility: eligibility ?? undefined,
          forceWeb: forceWeb ?? undefined,
          budget: budget ?? undefined,
        });
        return { summary: `sector job ${result.jobId}: ${result.companies} companies`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_status",
    {
      description: "Operator: sector job counts, active runs, tokens, ETA.",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        const status = await sectorPreflightStatus(db, id);
        return { summary: `sector job ${id}: ${status.job.status}`, data: status };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_list",
    {
      description: "Operator: recent sector jobs.",
      inputSchema: { limit: z.number().int().optional().describe("Default 20") },
    },
    async ({ limit }) =>
      wrap(async () => {
        const jobs = await sectorPreflightList(db, limit ?? undefined);
        return { summary: `${jobs.length} sector jobs`, data: { jobs } };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_pause",
    {
      description: "Operator: pause a sector job (in-flight classifications finish; nothing new starts).",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        await sectorPreflightPause(db, id);
        return { summary: `sector job ${id} paused`, data: { jobId: id } };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_resume",
    {
      description: "Operator: resume a paused sector job.",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        await sectorPreflightResume(db, id);
        return { summary: `sector job ${id} resumed`, data: { jobId: id } };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_cancel",
    {
      description: "Operator: cancel a sector job (running classifications are stopped).",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        await sectorPreflightCancel(db, id);
        return { summary: `sector job ${id} cancelled`, data: { jobId: id } };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_retry_failed",
    {
      description: "Operator: re-queue a sector job's failed companies and resume it.",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        const result = await sectorPreflightRetryFailed(db, id);
        return { summary: `sector job ${id}: ${result.retried} companies re-queued`, data: { jobId: id, retried: result.retried } };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_summary",
    {
      description: "Operator: classification counts by business_type x category x eligibility, with examples.",
      inputSchema: { sectorId: z.string().describe("Sector UUID") },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const summary = await sectorPreflightSummary(db, sectorId);
        return { summary: `${summary.buckets.length} buckets`, data: summary };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_companies",
    {
      description:
        "Operator: per-company classifications for a sector (eligibility, type, category, confidence, reason, quote), filtered, by name.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        eligibility: z.array(z.enum(["eligible", "review", "ineligible"])).optional(),
        confidence: z.array(z.enum(["high", "medium", "low"])).optional(),
        promptVersion: z.string().optional().describe("For example v2-web: rows Muse read with its web tools"),
        staleProfile: z.boolean().optional().describe("Only rows classified under different category keys (profile hash covers keys, not descriptions)"),
        companyIds: z.array(z.string()).optional(),
        limit: z.number().int().optional().describe("1..500 (default 50)"),
        offset: z.number().int().optional(),
      },
    },
    async (input) =>
      wrap(async () => {
        const result = await sectorPreflightCompanies(db, input);
        return { summary: `${result.rows.length} of ${result.total} companies`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "sector_icp_start",
    {
      description:
        "Operator: run the ICP check (6 signals, exclusions, from stored evidence only) as a sector job. Default: sector members whose research job completed and that have no check yet. Track it with sector_icp_status; pause/resume/cancel/retry with the sector_preflight_* job tools.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        companyIds: z.array(z.string()).optional().describe("Check exactly these sector members (researched or not)"),
        onlyMissing: z.boolean().optional().describe("Skip companies already checked in this sector (default true); false re-checks"),
        maxCompanies: z.number().int().optional().describe("Cap the job at this many companies"),
        budget: jobBudget,
      },
    },
    async ({ sectorId, companyIds, onlyMissing, maxCompanies, budget }) =>
      wrap(async () => {
        const result = await startSectorIcp(db, {
          sectorId,
          companyIds: companyIds ?? undefined,
          onlyMissing: onlyMissing ?? undefined,
          maxCompanies: maxCompanies ?? undefined,
          budget: budget ?? undefined,
        });
        return { summary: `icp job ${result.jobId}: ${result.companies} companies`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "sector_icp_status",
    {
      description: "Operator (read-only): an ICP sector job's counts, active runs, tokens, ETA (same view as sector_preflight_status).",
      inputSchema: { jobId },
    },
    async ({ jobId: id }) =>
      wrap(async () => {
        const status = await sectorPreflightStatus(db, id);
        if (status.job.kind !== "icp") throw new DomainError("invalid_input", "not an ICP job; use sector_preflight_status");
        return { summary: `icp job ${id}: ${status.job.status}`, data: status };
      }),
  );

  registerTool(server, db, auth,
    "company_icp_get",
    {
      description:
        "Operator (read-only): a company's latest ICP check: each signal, exclusion and flag with its verdict, cited evidence (quote, date, URL) and observation, plus today's tier, layer and status.",
      inputSchema: {
        companyId,
        sectorId: z.string().optional().describe("Sector UUID (resolved from the company's only sector when omitted)"),
      },
    },
    async ({ companyId: id, sectorId }) =>
      wrap(async () => {
        const view = await companyIcpView(db, id, await resolveCompanySector(db, id, sectorId));
        return {
          summary: view.check
            ? `score ${view.check.score}, ${view.status}, tier ${view.tier ?? "-"} layer ${view.layer ?? "-"}`
            : "no ICP check yet",
          data: view,
        };
      }),
  );

  registerTool(server, db, auth,
    "sector_icp_companies",
    {
      description:
        "Operator (read-only): the latest ICP check per sector member, with today's status, tier, layer, signals met and the tech team flag. Filter by status, tier or minimum score.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        status: z.array(z.enum(["icp_accepted", "icp_watchlist", "icp_rejected", "research_incomplete"])).optional(),
        tier: z.array(z.enum(["A", "B", "C"])).optional(),
        minScore: z.number().int().min(0).max(6).optional(),
        limit: z.number().int().optional().describe("1..500, default 50"),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ sectorId, status, tier, minScore, limit, offset }) =>
      wrap(async () => {
        const result = await sectorIcpCompanies(db, {
          sectorId,
          status: status ?? undefined,
          tier: tier ?? undefined,
          minScore: minScore ?? undefined,
          limit: limit ?? undefined,
          offset: offset ?? undefined,
        });
        return { summary: `${result.total} checked companies`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "company_contacts_get",
    {
      description:
        "Operator (read-only): a company's contact statuses (D-67), one row per status with people count and source. Public rows (name/role) come from cited leader records; Apollo rows from the people stored by apollo_contacts_import, which are listed too. contactable = an email_verified_apollo row exists. Separate from the ICP status.",
      inputSchema: { companyId },
    },
    async ({ companyId: id }) =>
      wrap(async () => {
        const view = await companyContacts(db, id);
        return {
          summary: `${view.statuses.map((r) => `${r.status}(${r.people})`).join(", ") || "no contact statuses"}; contactable: ${view.contactable}`,
          data: view,
        };
      }),
  );

  registerTool(server, db, auth,
    "apollo_contacts_import",
    {
      description:
        "Operator: store people from one of the owner's Apollo pulls (up to 500 per call), then rebuild those companies' Apollo contact statuses (D-67). Only for data the owner already bought from Apollo; never public sources, and it never calls Apollo or spends credits. Keyed by Apollo person id: a person already stored keeps any field the new pull leaves empty. Don't pass the company main line or personal emails.",
      inputSchema: {
        source: z.string().min(1).describe('The Apollo pull, e.g. "apollo pull 2026-10-27"'),
        pulledAt: z.string().describe("When the pull was made (ISO date)"),
        contacts: z
          .array(
            z
              .object({
                apolloId: z.string().min(1).describe("Apollo person id"),
                companyId: z.string().optional().describe("Company UUID (or pass domain)"),
                domain: z.string().optional().describe("Company domain (or pass companyId)"),
                name: z.string().nullable().optional(),
                title: z.string().nullable().optional(),
                email: z.string().nullable().optional(),
                emailStatus: z.string().nullable().optional().describe('Apollo\'s label; only "verified" makes a company contactable'),
                mobile: z.string().nullable().optional(),
                linkedin: z.string().nullable().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(500),
      },
    },
    async ({ source, pulledAt, contacts }) =>
      wrap(async () => {
        const at = new Date(pulledAt);
        if (Number.isNaN(at.getTime())) throw new DomainError("invalid_input", "pulledAt is not a date");
        const results = await importApolloContacts(db, {
          source,
          pulledAt: at,
          contacts: contacts.map((c) => ({ ...c, companyId: c.companyId ?? undefined, domain: c.domain ?? undefined })),
        });
        const ok = results.filter((r) => r.ok);
        const failed = results.filter((r) => !r.ok);
        return {
          summary: `${ok.length}/${results.length} stored (${ok.filter((r) => r.ok && r.outcome === "created").length} new), ${new Set(ok.map((r) => (r.ok ? r.companyId : ""))).size} companies, ${failed.length} failed`,
          data: { results: failed.length > 0 ? failed : [], stored: ok.length },
        };
      }),
  );

  registerTool(server, db, auth,
    "sector_contacts_rederive",
    {
      description:
        "Operator: rebuild the public contact statuses (name_verified_public, role_verified_public) for every sector member from its grounded leader records (D-67). Research jobs do this per company on their own; use this for a backfill.",
      inputSchema: { sectorId: z.string().describe("Sector UUID") },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const out = await rederiveSectorPublicContacts(db, sectorId);
        return {
          summary: `${out.companies} companies: ${out.withName} with a public name, ${out.withRole} with a public role`,
          data: out,
        };
      }),
  );

  registerTool(server, db, auth,
    "sector_profile_get",
    {
      description: "Operator: view a sector's preflight profile (categories, scope, classifier hints).",
      inputSchema: { sectorId: z.string().describe("Sector UUID") },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const profile = await getProfileOrNull(db, sectorId);
        return {
          summary: profile ? `${profile.categories.length} categories` : "no profile set for this sector",
          data: { profile },
        };
      }),
  );

  registerTool(server, db, auth,
    "sector_profile_set",
    {
      description:
        "Operator: validate and store a sector's preflight profile (the single sector config: categories, scope, tiering, prompt hints). Changing category keys after classifications exist is refused unless reclassify is true (marks them pending). Returns before/after eligibility counts and the changed top-level fields.",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        profile: z.unknown().describe("Full profile JSON (see the sector profile schema)"),
        reclassify: z.boolean().optional().describe("Allow a category-key change; marks classifications pending"),
      },
    },
    async ({ sectorId, profile, reclassify }) =>
      wrap(async () => {
        const result = await setProfile(db, sectorId, profile, { reclassify: reclassify ?? false });
        return {
          summary: `profile stored (${result.profile.categories.length} categories, ${result.reclassifyPending} pending; changed: ${result.changedFields.join(", ") || "none"})`,
          data: result,
        };
      }),
  );

  registerTool(server, db, auth,
    "company_eligibility_override",
    {
      description: "Operator: force-include or force-exclude a company (or clear the override).",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        companyId: z.string().describe("Company UUID"),
        decision: z.enum(["include", "exclude", "clear"]).describe("Override decision"),
        note: z.string().optional().describe("Why (stored with the override)"),
      },
    },
    async ({ sectorId, companyId, decision, note }) =>
      wrap(async () => {
        const result = await setOverride(db, sectorId, companyId, decision, note ?? undefined);
        return { summary: `override ${decision} -> ${result.eligibility}`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "sector_scope_apply",
    {
      description:
        "Operator: re-apply the stored profile's scope to every membership (override, then scope). Refused when the sector has no profile.",
      inputSchema: { sectorId: z.string().describe("Sector UUID") },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const result = await rederiveSectorScope(db, sectorId);
        const counts = await eligibilityCounts(db, sectorId);
        return {
          summary: `${result.eligible} eligible, ${result.ineligible} ineligible (${result.skippedOverride} overrides, ${result.skippedPending} pending kept)`,
          data: { ...result, counts },
        };
      }),
  );

  registerTool(server, db, auth,
    "pipeline_start",
    {
      description: "Operator: launch company jobs for a sector's eligible companies only (review/pending never included).",
      inputSchema: {
        sectorId: z.string().describe("Sector UUID"),
        categories: z.array(z.string()).optional().describe("Only these primary categories (from the sector profile, e.g. its core categories)"),
      },
    },
    async ({ sectorId, categories }) =>
      wrap(async () => {
        const result = await startPipeline(db, sectorId, { categories: categories ?? undefined });
        return { summary: `${result.created} jobs created (${result.skipped} already had one)`, data: result };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_concurrency_get",
    {
      description: "Operator: read the sector-preflight pool size.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const settings = await sectorPreflightSettingsGet(db);
        return { summary: `sectorPreflightConcurrency = ${settings.sectorPreflightConcurrency} (${settings.source})`, data: settings };
      }),
  );

  registerTool(server, db, auth,
    "sector_preflight_concurrency_set",
    {
      description: "Operator: change the sector-preflight pool size at runtime (1..64, stored in the DB, immediate).",
      inputSchema: { sectorPreflightConcurrency: z.number().int().describe("Max parallel classifications") },
    },
    async ({ sectorPreflightConcurrency: value }) =>
      wrap(async () => {
        const settings = await sectorPreflightSettingsSet(db, value);
        return { summary: `sectorPreflightConcurrency -> ${settings.sectorPreflightConcurrency}`, data: settings };
      }),
  );
}
