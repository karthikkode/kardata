import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
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
  listRunEvents,
  searchAll,
} from "../domain/research/reads.js";
import { cancelRun, getOrCreateManualRun, startCollect } from "../runs/queue.js";
import { DomainError } from "../domain/errors.js";
import { companyId, runId, wrap } from "./tools.js";

const areaName = z.string().describe("Research area");
const tags = z.array(z.string()).optional().describe("Tags");
const sourceIds = z.array(z.string()).describe("Source UUIDs (at least one)");

function privateHostAllowlist(): string[] {
  const raw = process.env.KARDATA_PRIVATE_HOST_ALLOWLIST ?? "";
  return raw.split(",").map((h) => h.trim()).filter((h) => h !== "");
}

function slugifyTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug !== "" ? slug : "note";
}

export function registerResearchTools(server: McpServer, db: Db): void {
  server.registerTool(
    "collect_start",
    {
      description: "Queue a collect run per company (at most 100). Returns the batch id plus, per company, a run id or already_running.",
      inputSchema: {
        companyIds: z.array(z.string()).describe("Company UUIDs (1..100)"),
        areas: z.array(z.string()).optional().describe("Limit the run to these areas"),
      },
    },
    async ({ companyIds, areas }) =>
      wrap(async () => {
        const batch = await startCollect(db, companyIds, areas ?? undefined);
        const queued = batch.runs.filter((r) => r.status === "queued").length;
        return { summary: `batch ${batch.batchId}: ${queued} queued, ${batch.runs.length - queued} already running`, data: batch };
      }),
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
        const doc = await getDocument(db, { documentId, offset: offset ?? undefined, maxChars: maxChars ?? undefined });
        return { summary: `"${doc.title}" v${doc.version}${doc.truncated ? " (truncated)" : ""}`, data: doc };
      }),
  );

  server.registerTool(
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

  server.registerTool(
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
        const source = await getSourceExcerpt(db, { sourceId, maxChars: maxChars ?? undefined });
        return { summary: `${source.url} (${source.status})`, data: source };
      }),
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
        const run = givenRunId ?? (await getOrCreateManualRun(db, companyId));
        const fetched = await fetchUrl(db, {
          runId: run,
          companyId,
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

  server.registerTool(
    "source_capture",
    {
      description: "Store content seen some other way (via search | browser | muse_fetch) so it has an id and a snapshot. Returns the source id.",
      inputSchema: {
        companyId,
        runId: runId.optional().describe("Defaults to today's manual run for the company"),
        url: z.string().describe("http(s) URL the content came from"),
        title: z.string().optional(),
        text: z.string().describe("The content itself"),
        via: z.enum(["search", "browser", "muse_fetch"]),
      },
    },
    async ({ companyId, runId: givenRunId, url, title, text, via }) =>
      wrap(async () => {
        const run = givenRunId ?? (await getOrCreateManualRun(db, companyId));
        const sourceId = await captureSource(db, {
          companyId,
          runId: run,
          url,
          title: title ?? undefined,
          text,
          via,
          createdBy: "owner",
        });
        return { summary: `captured ${url} via ${via}`, data: { sourceId, runId: run } };
      }),
  );

  server.registerTool(
    "fact_add",
    {
      description: "Write facts (at most 200). Unknown keys and qualifiers are auto-created as provisional, with warnings. Returns per-item ok/error.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
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
    async ({ companyId, runId, facts }) =>
      wrap(async () => {
        if (facts.length > FACT_BATCH_MAX) {
          throw new DomainError("invalid_input", `at most ${FACT_BATCH_MAX} facts per call`);
        }
        const run = runId ?? (await getOrCreateManualRun(db, companyId));
        const results = await addFacts(db, {
          companyId,
          runId: run,
          createdBy: "owner",
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

  server.registerTool(
    "record_upsert",
    {
      description: "Upsert records (at most 500) on natural keys. Unknown types and fields are auto-created, with warnings. Returns per-item created/updated/unchanged/rejected.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
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
    async ({ companyId, runId, records }) =>
      wrap(async () => {
        if (records.length > RECORD_BATCH_MAX) {
          throw new DomainError("invalid_input", `at most ${RECORD_BATCH_MAX} records per call`);
        }
        const run = runId ?? (await getOrCreateManualRun(db, companyId));
        const results = await upsertRecords(db, {
          companyId,
          runId: run,
          createdBy: "owner",
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

  server.registerTool(
    "reviews_ingest",
    {
      description: "Bulk reviews (at most 500): dedupe, identity stripped, 5,000/platform kept, rating facts recomputed. Returns per-item results plus recomputed keys.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
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
    async ({ companyId, runId, platform, sourceId, reviews }) =>
      wrap(async () => {
        if (reviews.length > REVIEWS_BATCH_MAX) {
          throw new DomainError("invalid_input", `at most ${REVIEWS_BATCH_MAX} reviews per call`);
        }
        const run = runId ?? (await getOrCreateManualRun(db, companyId));
        const result = await reviewsIngest(db, {
          companyId,
          runId: run,
          platform,
          sourceId,
          reviews,
          createdBy: "owner",
        });
        const okCount = result.results.filter((r) => r.ok).length;
        return {
          summary: `${okCount}/${result.results.length} reviews ingested${result.trimmed > 0 ? `, ${result.trimmed} trimmed` : ""}`,
          data: result,
        };
      }),
  );

  server.registerTool(
    "document_save",
    {
      description: "Save a versioned markdown document at any lowercase path (area = first folder, else other). Saving identical content is a no-op. Returns id, version and outcome.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
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
    async ({ companyId, runId, path, kind, title, content, sourceIds, factIds, recordIds, tags }) =>
      wrap(async () => {
        const run = runId ?? (await getOrCreateManualRun(db, companyId));
        const saved = await saveDocument(db, {
          companyId,
          runId: run,
          path,
          kind: kind ?? undefined,
          title: title ?? undefined,
          contentMd: content,
          sourceIds: sourceIds ?? undefined,
          factIds: factIds ?? undefined,
          recordIds: recordIds ?? undefined,
          tags: tags ?? undefined,
          createdBy: "owner",
        });
        return { summary: `saved ${path} v${saved.version} (${saved.outcome})`, data: saved };
      }),
  );

  server.registerTool(
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
        const docs = await listDocuments(db, { companyId, prefix: prefix ?? undefined, limit: limit ?? undefined });
        return { summary: `${docs.length} documents`, data: { documents: docs } };
      }),
  );

  server.registerTool(
    "document_history",
    {
      description: "Every version of a document, newest first. Returns the versions.",
      inputSchema: { documentId: z.string().describe("Document UUID") },
    },
    async ({ documentId }) =>
      wrap(async () => {
        const versions = await getDocumentHistory(db, documentId);
        return { summary: `${versions.length} versions`, data: { versions } };
      }),
  );

  server.registerTool(
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

  server.registerTool(
    "finding_add",
    {
      description: "Add one finding: claim plus supporting sources, optional fact/record links. Needs at least one source. Returns the finding id.",
      inputSchema: {
        companyId,
        runId: runId.optional(),
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
    async ({ companyId, runId, area, claim, detail, sourceIds, factIds, recordIds, confidence, status, tags }) =>
      wrap(async () => {
        const run = runId ?? (await getOrCreateManualRun(db, companyId));
        const id = await addFinding(db, {
          companyId,
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
          createdBy: "owner",
        });
        return { summary: `added finding ${id}`, data: { id } };
      }),
  );

  server.registerTool(
    "area_status_set",
    {
      description: "Record an area status. Non-done statuses need a reason. Returns the status.",
      inputSchema: {
        runId,
        area: areaName,
        status: z.string().describe("done, not_found, blocked, error or skipped"),
        reason: z.string().nullable().optional(),
      },
    },
    async ({ runId, area, status, reason }) =>
      wrap(async () => {
        await setAreaStatus(db, { runId, area, status, reason: reason ?? null });
        return { summary: `${area}: ${status}`, data: { runId, area, status } };
      }),
  );

  server.registerTool(
    "company_context",
    {
      description: "Everything known about a company: current facts, record counts per type, the document tree, findings, area statuses. Returns the context.",
      inputSchema: { companyId },
    },
    async ({ companyId }) =>
      wrap(async () => {
        const context = await getCompanyContext(db, companyId);
        return { summary: `context for "${context.company.name}"`, data: context };
      }),
  );

  server.registerTool(
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
          companyId,
          keys: keys ?? undefined,
          history: history ?? undefined,
          limit: limit ?? undefined,
        });
        return { summary: `${facts.length} facts`, data: { facts } };
      }),
  );

  server.registerTool(
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
          companyId,
          type,
          query: query ?? undefined,
          limit: limit ?? undefined,
        });
        return { summary: `${records.length} ${type} records`, data: { records } };
      }),
  );

  server.registerTool(
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
          companyId: companyId ?? undefined,
          kinds: kinds ?? undefined,
          area: area ?? undefined,
          tags: tags ?? undefined,
          limit: limit ?? undefined,
        });
        return { summary: `${hits.length} hits`, data: { hits } };
      }),
  );
}
